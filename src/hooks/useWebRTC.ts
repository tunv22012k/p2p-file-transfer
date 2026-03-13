import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { RTC_ICE_SERVERS, CHUNK_SIZE, MAX_BUFFERED_AMOUNT } from '@/lib/webrtc-config';
import { ConnectionStatus, FileMetadata, TransferProgress } from '@/types/webrtc';
import { encryptChunk, decryptChunk, generateKeyString, importKeyString } from '@/lib/crypto';

// Adjust this URL to your signaling server address when deploying
const SIGNALING_SERVER_URL = 'http://localhost:3001';

export function useWebRTC() {
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected');
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  
  // For UI to show "Incoming file request"
  const [incomingRequest, setIncomingRequest] = useState<{from: string, metadata: FileMetadata} | null>(null);
  
  // For Link auto-transactions: File is offered, receiver needs to click Accept to trigger Save Dialog
  const [incomingFileMetadata, setIncomingFileMetadata] = useState<FileMetadata | null>(null);

  const [myId, setMyId] = useState<string>('');
  const [roomUsers, setRoomUsers] = useState<string[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);

  // Transfer state
  const receiveBufferRef = useRef<FileSystemWritableFileStream | null>(null);
  const receiveMetadataRef = useRef<FileMetadata | null>(null);
  const receivedSizeRef = useRef<number>(0);
  const transferStartTime = useRef<number>(0);

  const initWebRTC = useCallback(() => {
    if (pcRef.current) return pcRef.current;
    
    const pc = new RTCPeerConnection(RTC_ICE_SERVERS);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          setStatus('Connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setStatus('Disconnected');
          break;
        default:
          setStatus('Connecting');
          break;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && remotePeerIdRef.current) {
        socketRef.current?.emit('ice-candidate', {
          to: remotePeerIdRef.current,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };

    return pc;
  }, []);

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dcRef.current = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      if (pcRef.current?.connectionState === 'connected' || pcRef.current?.connectionState === 'connecting') {
        setStatus('Connected');
      }
    };

    channel.onclose = () => {
      setStatus('Disconnected');
      receiveBufferRef.current = null;
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'metadata') {
          receiveMetadataRef.current = msg.data as FileMetadata;
          receivedSizeRef.current = 0;
          setIsReceiving(true);
          transferStartTime.current = Date.now();

          if (msg.keyStr) {
            try {
              cryptoKeyRef.current = await importKeyString(msg.keyStr);
            } catch (err) {
              console.error("Failed to import key from peer", err);
            }
          }

          if (receiveBufferRef.current) {
             // Room Sharing: User already clicked Accept and chose a save location!
             channel.send(JSON.stringify({ type: 'ready' }));
          } else {
             // Link Sharing: Wait for the user to click "Save File" in the UI.
             setIncomingFileMetadata(receiveMetadataRef.current);
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        if (receiveBufferRef.current && receiveMetadataRef.current) {
          try {
            let chunkBuf = event.data;
            // Decrypt if we have a key
            if (cryptoKeyRef.current) {
               chunkBuf = await decryptChunk(chunkBuf, cryptoKeyRef.current);
            }
            
            await receiveBufferRef.current.write(chunkBuf);
            receivedSizeRef.current += chunkBuf.byteLength;

            const now = Date.now();
            const elapsed = (now - transferStartTime.current) / 1000;
            const currentSpeed = elapsed > 0 ? receivedSizeRef.current / elapsed : 0;
            
            setProgress({
              progress: (receivedSizeRef.current / receiveMetadataRef.current.size) * 100,
              bytesTransferred: receivedSizeRef.current,
              totalBytes: receiveMetadataRef.current.size,
              speed: currentSpeed,
            });

            if (receivedSizeRef.current >= receiveMetadataRef.current.size) {
              await receiveBufferRef.current.close();
              receiveBufferRef.current = null;
              setIsReceiving(false);
              setProgress(null);
              alert('File download complete!');
            }
          } catch (err) {
            console.error("Failed to decrypt or write chunk:", err);
            channel.close();
          }
        }
      }
    };
  }, []);

  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER_URL);

    socketRef.current.on('your-id', (id) => {
      setMyId(id);
    });

    // Room functionality
    socketRef.current.on('room-users', (users) => {
      setRoomUsers(users);
    });

    socketRef.current.on('peer-joined', (peerId) => {
      setRoomUsers(prev => [...prev, peerId]);
    });

    socketRef.current.on('peer-left', (peerId) => {
      setRoomUsers(prev => prev.filter(id => id !== peerId));
    });

    // Link Sharing: Someone opened our link and wants to connect
    socketRef.current.on('incoming-direct-connection', async (peerId) => {
      remotePeerIdRef.current = peerId;
      const pc = initWebRTC();
      const dc = pc.createDataChannel('fileTransfer');
      setupDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socketRef.current?.emit('offer', {
        to: peerId,
        sdp: { type: offer.type, sdp: offer.sdp }
      });
    });

    // Signaling protocol
    socketRef.current.on('offer', async (data) => {
      remotePeerIdRef.current = data.from;
      const pc = initWebRTC();
      
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socketRef.current?.emit('answer', {
        to: data.from,
        sdp: { type: answer.type, sdp: answer.sdp }
      });
    });

    socketRef.current.on('answer', async (data) => {
      const pc = pcRef.current;
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    });

    socketRef.current.on('ice-candidate', async (data) => {
      const pc = pcRef.current;
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("Error adding ice candidate", e);
        }
      }
    });

    // File Request Protocol
    socketRef.current.on('file-request', (data) => {
      setIncomingRequest({ from: data.from, metadata: data.metadata });
    });

    return () => {
      socketRef.current?.disconnect();
      pcRef.current?.close();
      dcRef.current?.close();
    };
  }, [initWebRTC, setupDataChannel]);

  // Methods to expose to components
  const joinRoom = (roomId: string) => {
    socketRef.current?.emit('join-room', roomId);
  };

  const connectToPeer = (peerId: string) => {
    socketRef.current?.emit('request-direct-connection', peerId);
  };

  const requestFileSend = (targetPeerId: string, metadata: FileMetadata) => {
    return new Promise<boolean>((resolve) => {
       socketRef.current?.emit('file-request', { to: targetPeerId, metadata });
       
       const onAccept = async (data: any) => {
         if (data.from === targetPeerId) {
             cleanup();
             
             // Setup WebRTC connection NOW, and wait for it to open before resolving true
             remotePeerIdRef.current = targetPeerId;
             const pc = initWebRTC();
             const dc = pc.createDataChannel('fileTransfer');
             setupDataChannel(dc);
             
             // Wait for datachannel to actually be open before we say "accepted" (to prevent 'Connection not open' errors)
             dc.addEventListener('open', () => {
                resolve(true); 
             });
             
             const offer = await pc.createOffer();
             await pc.setLocalDescription(offer);
             socketRef.current?.emit('offer', {
               to: targetPeerId,
               sdp: { type: offer.type, sdp: offer.sdp }
             });
         }
       };
       const onReject = (data: any) => {
         if (data.from === targetPeerId) {
             cleanup();
             resolve(false);
         }
       };
       
       const cleanup = () => {
          socketRef.current?.off('file-request-accepted', onAccept);
          socketRef.current?.off('file-request-rejected', onReject);
       };
       
       socketRef.current?.on('file-request-accepted', onAccept);
       socketRef.current?.on('file-request-rejected', onReject);
    });
  };

  const answerFileRequest = async (accept: boolean) => {
    if (!incomingRequest) return;
    
    if (accept) {
      try {
        // Since this is triggered by a real user click, we can legally pop the Save dialog here without SecurityError
        // @ts-ignore
        const handle = await window.showSaveFilePicker({
          suggestedName: incomingRequest.metadata.name,
        });
        receiveBufferRef.current = await handle.createWritable();
        receiveMetadataRef.current = incomingRequest.metadata;
        receivedSizeRef.current = 0;
        setIsReceiving(true);
        transferStartTime.current = Date.now();
        
        // Notify the sender we are ready, so they can initiate the WebRTC offer 
        socketRef.current?.emit('file-request-accepted', { to: incomingRequest.from });
      } catch (e) {
        console.error("User cancelled picker or error:", e);
        // Treat as rejected if they cancel the save prompt
        socketRef.current?.emit('file-request-rejected', { to: incomingRequest.from });
        setIncomingRequest(null);
        return;
      }
    } else {
      socketRef.current?.emit('file-request-rejected', { to: incomingRequest.from });
    }
    setIncomingRequest(null);
  };

  const setCryptoKey = (key: CryptoKey) => {
    cryptoKeyRef.current = key;
  };

  const acceptFileTransfer = async () => {
     if (!incomingFileMetadata || !dcRef.current) return;
     
     try {
       // @ts-ignore
       const handle = await window.showSaveFilePicker({
         suggestedName: incomingFileMetadata.name,
       });
       receiveBufferRef.current = await handle.createWritable();
       dcRef.current.send(JSON.stringify({ type: 'ready' }));
       setIncomingFileMetadata(null); // Clear prompt
     } catch (e) {
       console.error('User cancelled save prompt or error:', e);
       dcRef.current.send(JSON.stringify({ type: 'error', error: 'User cancelled or failed to save' }));
       setIsReceiving(false);
       setIncomingFileMetadata(null);
     }
  };

  const sendFile = useCallback(async (file: File) => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') {
      alert('Connection is not open.');
      return;
    }

    const metadata: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type,
    };

    // If no key is set (e.g. Room sharing), generate one for this transfer
    let shareKeyStr = '';
    if (!cryptoKeyRef.current) {
        shareKeyStr = await generateKeyString();
        cryptoKeyRef.current = await importKeyString(shareKeyStr);
    }

    dcRef.current.send(JSON.stringify({ 
      type: 'metadata', 
      data: metadata, 
      keyStr: shareKeyStr || undefined 
    }));

    const waitForReady = new Promise<void>((resolve, reject) => {
      const dc = dcRef.current!;
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            dc.removeEventListener('message', onMessage);
            resolve();
          } else if (msg.type === 'error') {
            dc.removeEventListener('message', onMessage);
            reject(new Error(msg.error));
          }
        }
      };
      dc.addEventListener('message', onMessage);
    });

    try {
      await waitForReady;
    } catch (e) {
      alert('Receiver refused the file transfer.');
      return;
    }

    const start = Date.now();
    let offset = 0;

    // Stream Reader approach for handling massive files without RAM crash
    const stream = file.stream();
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let chunk = value;
      let chunkOffset = 0;

      // Slice the read chunk into optimal CHUNK_SIZE pieces for WebRTC
      while (chunkOffset < chunk.length) {
         if (dcRef.current!.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          await new Promise<void>((resolve) => {
            const dc = dcRef.current!;
            const onLow = () => {
              dc.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            dc.addEventListener('bufferedamountlow', onLow);
          });
         }

         if (dcRef.current!.readyState !== 'open') return;

         const end = Math.min(chunkOffset + CHUNK_SIZE, chunk.length);
         let slice = chunk.slice(chunkOffset, end).buffer;
         chunkOffset = end;

         // Encrypt if we have a key
         if (cryptoKeyRef.current) {
            slice = await encryptChunk(slice, cryptoKeyRef.current);
         }

         dcRef.current!.send(slice);
         offset += slice.byteLength; // Note: For progress, this includes encryption overhead

         const now = Date.now();
         const elapsed = (now - start) / 1000;
         const currentSpeed = elapsed > 0 ? offset / elapsed : 0;

         // We use the original file size for progress, recognizing that encrypted length is slightly different
         setProgress({
           progress: (offset / (file.size + (file.size/CHUNK_SIZE)*28)) * 100, // Roughly account for AES-GCM tag/IV overhead
           bytesTransferred: offset,
           totalBytes: file.size,
           speed: currentSpeed,
         });
      }
    }

    // Done sending
    setProgress(null);
    alert('File sent successfully!');
  }, []);

  return { 
    myId, 
    status, 
    progress, 
    sendFile, 
    isReceiving,
    joinRoom,
    connectToPeer,
    roomUsers,
    requestFileSend,
    incomingRequest,
    answerFileRequest,
    setCryptoKey,
    incomingFileMetadata,
    acceptFileTransfer,
  };
}
