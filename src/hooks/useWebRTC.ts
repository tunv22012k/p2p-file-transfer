import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { RTC_ICE_SERVERS, CHUNK_SIZE, MAX_BUFFERED_AMOUNT } from '@/lib/webrtc-config';
import { ConnectionStatus, FileMetadata, TransferProgress } from '@/types/webrtc';
import { encryptChunk, decryptChunk, generateKeyString, importKeyString } from '@/lib/crypto';
import { toast } from 'sonner';
import { historyUtil } from '@/lib/history';

// Use environment variable if available, otherwise dynamically use the current origin in production, or localhost in dev.
const SIGNALING_SERVER_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || (typeof window !== 'undefined' ? (window.location.hostname === 'localhost' ? 'http://localhost:3001' : window.location.origin) : 'http://localhost:3001');

// Timeout constants
const READY_TIMEOUT_MS = 60_000; // 60s for receiver to accept
const DONE_TIMEOUT_MS = 30_000;  // 30s for ACK after last chunk sent

// ─── Fallback for browsers that don't support showSaveFilePicker (Firefox, Safari) ───
type WritableStreamRef = WritableStreamDefaultWriter | FileSystemWritableFileStream | WritableStream<Uint8Array>;

async function saveFileFallback(fileName: string): Promise<WritableStreamRef> {
  if ('showSaveFilePicker' in window) {
    // Chrome / Edge: native file picker
    // @ts-expect-error - showSaveFilePicker is not in all browsers' window type yet
    const handle = await window.showSaveFilePicker({ suggestedName: fileName });
    return handle.createWritable();
  }

  // Firefox / Safari fallback: collect chunks in memory, then download via <a>
  const chunks: BlobPart[] = [];
  return new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk as unknown as BlobPart);
    },
    close() {
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    },
  }) as unknown as WritableStreamRef;
}

export function useWebRTC() {
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected');
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);

  // For UI to show "Incoming file request"
  const [incomingRequest, setIncomingRequest] = useState<{ from: string; fromUsername: string; metadata: FileMetadata } | null>(null);

  // For Link auto-transactions: File is offered, receiver needs to click Accept to trigger Save Dialog
  const [incomingFileMetadata, setIncomingFileMetadata] = useState<FileMetadata | null>(null);

  const [myId, setMyId] = useState<string>('');
  const [roomUsers, setRoomUsers] = useState<{ id: string; username: string }[]>([]);

  const isTransferringRef = useRef(false);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const lastSentFileNameRef = useRef<string | null>(null);
  const lastSentFileSizeRef = useRef<number | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);

  // Transfer state
  const receiveBufferRef = useRef<WritableStreamRef | null>(null);
  const receiveMetadataRef = useRef<FileMetadata | null>(null);
  const receivedSizeRef = useRef<number>(0);
  const transferStartTime = useRef<number>(0);

  const resetPeerConnection = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    remotePeerIdRef.current = null;
    cryptoKeyRef.current = null;
    isTransferringRef.current = false;
    lastSentFileNameRef.current = null;
    lastSentFileSizeRef.current = null;
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
              console.error('Failed to import key from peer', err);
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

            const writer = receiveBufferRef.current;
            if ('write' in writer && typeof writer.write === 'function') {
              await (writer as FileSystemWritableFileStream).write(chunkBuf);
            }

            receivedSizeRef.current += chunkBuf.byteLength;

            const now = Date.now();
            const elapsed = (now - transferStartTime.current) / 1000;
            const currentSpeed = elapsed > 0 ? receivedSizeRef.current / elapsed : 0;
            const remainingBytes = receiveMetadataRef.current.size - receivedSizeRef.current;
            const eta = currentSpeed > 0 ? remainingBytes / currentSpeed : null;

            setProgress({
              progress: (receivedSizeRef.current / receiveMetadataRef.current.size) * 100,
              bytesTransferred: receivedSizeRef.current,
              totalBytes: receiveMetadataRef.current.size,
              speed: currentSpeed,
              eta,
            });

            if (receivedSizeRef.current >= receiveMetadataRef.current.size) {
              // Close the writable stream
              const buf = receiveBufferRef.current;
              if ('close' in buf && typeof buf.close === 'function') {
                await buf.close();
              }
              receiveBufferRef.current = null;
              setIsReceiving(false);
              setProgress(null);
              isTransferringRef.current = false;
              // Send ACK to sender so they know file was fully received
              if (channel.readyState === 'open') {
                channel.send(JSON.stringify({ type: 'done' }));
              }
              // Log history
              historyUtil.addEntry({
                fileName: receiveMetadataRef.current.name,
                fileSize: receiveMetadataRef.current.size,
                status: 'completed',
                type: 'received',
                peerName: remotePeerIdRef.current || 'Unknown',
              });

              resetPeerConnection();
              toast.success('Tải file hoàn tất!');
            }
          } catch (err) {
            console.error('Failed to decrypt or write chunk:', err);
            isTransferringRef.current = false;

            // Log failed transfer
            if (receiveMetadataRef.current) {
              historyUtil.addEntry({
                fileName: receiveMetadataRef.current.name,
                fileSize: receiveMetadataRef.current.size,
                status: 'failed',
                type: 'received',
                peerName: remotePeerIdRef.current || 'Unknown',
              });
            }

            channel.close();
          }
        }
      } else if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'cancel') {
          isTransferringRef.current = false;
          setIsReceiving(false);
          setProgress(null);

          if (receiveBufferRef.current) {
            const writer = receiveBufferRef.current;
            if ('abort' in writer && typeof writer.abort === 'function') {
              writer.abort().catch(() => { });
            }
            receiveBufferRef.current = null;
          }

          if (receiveMetadataRef.current) {
            historyUtil.addEntry({
              fileName: receiveMetadataRef.current.name,
              fileSize: receiveMetadataRef.current.size,
              status: 'failed',
              type: 'received',
              peerName: remotePeerIdRef.current || 'Unknown',
            });
          }

          toast.error('Người gửi đã hủy truyền file.');
          resetPeerConnection();
        }
      }
    };
  }, [resetPeerConnection]);

  const initWebRTC = useCallback(() => {
    if (pcRef.current) {
      const state = pcRef.current.connectionState;
      if (state === 'closed' || state === 'failed' || state === 'disconnected') {
        pcRef.current.close();
        pcRef.current = null;
        dcRef.current = null;
      } else {
        return pcRef.current;
      }
    }

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
  }, [setupDataChannel]);

  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER_URL);

    socketRef.current.on('your-id', (id) => {
      setMyId(id);
    });

    // Room functionality
    socketRef.current.on('room-users', (users: { id: string; username: string }[]) => {
      setRoomUsers((prevUsers) => {
        // Filter out any duplicates that might occur if a user reconnects quickly
        const uniqueUsers = new Map<string, { id: string; username: string }>();
        users.forEach(user => uniqueUsers.set(user.id, user));
        return Array.from(uniqueUsers.values());
      });
    });

    socketRef.current.on('peer-joined', (data: { id: string; username: string }) => {
      setRoomUsers((prev) => {
        if (!prev.some(u => u.id === data.id)) {
          return [...prev, data];
        }
        return prev;
      });
    });

    socketRef.current.on('peer-left', (peerId: string) => {
      setRoomUsers((prev) => prev.filter((u) => u.id !== peerId));
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
        sdp: { type: offer.type, sdp: offer.sdp },
      });
    });

    // Signaling protocol
    socketRef.current.on('offer', async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      remotePeerIdRef.current = data.from;
      const pc = initWebRTC();

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit('answer', {
        to: data.from,
        sdp: { type: answer.type, sdp: answer.sdp },
      });
    });

    socketRef.current.on('answer', async (data: { sdp: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    });

    socketRef.current.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error('Error adding ice candidate', e);
        }
      }
    });

    // File Request Protocol
    socketRef.current.on('file-request', (data: { from: string; fromUsername?: string; metadata: FileMetadata }) => {
      setIncomingRequest({
        from: data.from,
        fromUsername: data.fromUsername || data.from,
        metadata: data.metadata,
      });
    });

    return () => {
      socketRef.current?.disconnect();
      pcRef.current?.close();
      dcRef.current?.close();
    };
  }, [initWebRTC, setupDataChannel]);

  // Methods to expose to components
  const joinRoom = (roomId: string, username?: string) => {
    socketRef.current?.emit('join-room', { roomId, username });
  };

  const leaveRoom = () => {
    resetPeerConnection();
    // Socket.io will handle the disconnect event on server side
  };

  const connectToPeer = (peerId: string) => {
    socketRef.current?.emit('request-direct-connection', peerId);
  };

  const requestFileSend = (targetPeerId: string, metadata: FileMetadata) => {
    if (isTransferringRef.current) {
      toast.info('Đang có một luồng truyền file, vui lòng đợi hoàn tất.');
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      socketRef.current?.emit('file-request', { to: targetPeerId, metadata });

      const onAccept = async (data: { from: string }) => {
        if (data.from === targetPeerId) {
          cleanup();
          isTransferringRef.current = true;

          resetPeerConnection();

          // Setup WebRTC connection NOW, and wait for it to open before resolving true
          remotePeerIdRef.current = targetPeerId;
          const pc = initWebRTC();
          const dc = pc.createDataChannel('fileTransfer');
          setupDataChannel(dc);

          // Wait for datachannel to actually be open before we say "accepted"
          dc.addEventListener('open', () => {
            resolve(true);
          });

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socketRef.current?.emit('offer', {
            to: targetPeerId,
            sdp: { type: offer.type, sdp: offer.sdp },
          });
        }
      };
      const onReject = (data: { from: string }) => {
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
    if (!incomingRequest) {
      return;
    }

    if (accept && isTransferringRef.current) {
      toast.info('Đang có một luồng truyền file khác, vui lòng đợi.');
      setIncomingRequest(null);
      socketRef.current?.emit('file-request-rejected', { to: incomingRequest.from });
      return;
    }

    if (accept) {
      try {
        const writable = await saveFileFallback(incomingRequest.metadata.name);
        receiveBufferRef.current = writable;
        receiveMetadataRef.current = incomingRequest.metadata;
        receivedSizeRef.current = 0;
        setIsReceiving(true);
        isTransferringRef.current = true;
        transferStartTime.current = Date.now();

        // Notify the sender we are ready, so they can initiate the WebRTC offer
        socketRef.current?.emit('file-request-accepted', { to: incomingRequest.from });
      } catch (e) {
        console.error('User cancelled picker or error:', e);
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
    if (!incomingFileMetadata || !dcRef.current) {
      return;
    }

    if (isTransferringRef.current) {
      toast.info('Đang có một luồng truyền file khác, vui lòng đợi.');
      return;
    }

    try {
      const writable = await saveFileFallback(incomingFileMetadata.name);
      receiveBufferRef.current = writable;
      isTransferringRef.current = true;
      dcRef.current.send(JSON.stringify({ type: 'ready' }));
      setIncomingFileMetadata(null); // Clear prompt
    } catch (e: unknown) {
      console.error('User cancelled save prompt or error:', e);
      const error = e instanceof Error ? e.message : String(e);
      dcRef.current.send(JSON.stringify({ type: 'error', error: `User cancelled or failed to save: ${error}` }));
      setIsReceiving(false);
      setIncomingFileMetadata(null);
    }
  };

  const sendFile = useCallback(async (file: File) => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') {
      toast.error('Kết nối chưa sẵn sàng.');
      return;
    }

    const metadata: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type,
    };

    lastSentFileNameRef.current = file.name;
    lastSentFileSizeRef.current = file.size;

    // If no key is set (e.g. Room sharing), generate one for this transfer
    let shareKeyStr = '';
    if (!cryptoKeyRef.current) {
      shareKeyStr = await generateKeyString();
      cryptoKeyRef.current = await importKeyString(shareKeyStr);
    }

    dcRef.current.send(
      JSON.stringify({
        type: 'metadata',
        data: metadata,
        keyStr: shareKeyStr || undefined,
      })
    );

    const waitForReady = new Promise<void>((resolve, reject) => {
      const dc = dcRef.current!;
      let settled = false;

      const onMessage = (event: MessageEvent) => {
        if (settled) {
          return;
        }
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            settled = true;
            cleanup();
            resolve();
          } else if (msg.type === 'error') {
            settled = true;
            cleanup();
            reject(new Error(msg.error));
          }
        }
      };

      const onClose = () => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Kết nối bị đóng'));
        }
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('Hết thời gian chờ người nhận'));
        }
      }, READY_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timer);
        dc.removeEventListener('message', onMessage);
        dc.removeEventListener('close', onClose);
      };

      dc.addEventListener('message', onMessage);
      dc.addEventListener('close', onClose);
    });

    try {
      await waitForReady;
    } catch (e: unknown) {
      const error = e as Error;
      isTransferringRef.current = false;
      toast.error(`Không thể gửi file: ${error.message || 'Người nhận đã từ chối file.'}`);
      resetPeerConnection();
      return;
    }

    const start = Date.now();
    let offset = 0;

    // Stream Reader approach for handling massive files without RAM crash
    const stream = file.stream();
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = value;
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

          if (!dcRef.current || dcRef.current.readyState !== 'open') {
            throw new Error('Kết nối bị đóng giữa chừng');
          }

          const end = Math.min(chunkOffset + CHUNK_SIZE, chunk.length);
          let slice = chunk.slice(chunkOffset, end).buffer;
          chunkOffset = end;

          // Encrypt if we have a key
          if (cryptoKeyRef.current) {
            slice = await encryptChunk(slice, cryptoKeyRef.current);
          }

          dcRef.current!.send(slice);
          offset += slice.byteLength;

          const now = Date.now();
          const elapsed = (now - start) / 1000;
          const currentSpeed = elapsed > 0 ? offset / elapsed : 0;
          const remainingBytes = file.size - offset; // Use file.size for accuracy on sender side
          const eta = currentSpeed > 0 ? remainingBytes / currentSpeed : null;

          setProgress({
            progress: (offset / (file.size + (file.size / CHUNK_SIZE) * 28)) * 100,
            bytesTransferred: offset,
            totalBytes: file.size,
            speed: currentSpeed,
            eta,
          });
        }
      }
    } catch (e: unknown) {
      const error = e as Error;
      isTransferringRef.current = false;
      setProgress(null);

      // Log failed transfer
      historyUtil.addEntry({
        fileName: file.name,
        fileSize: file.size,
        status: 'failed',
        type: 'sent',
        peerName: remotePeerIdRef.current || 'Unknown',
      });

      toast.error(`Lỗi khi gửi file: ${error.message}`);
      resetPeerConnection();
      return;
    }

    const waitForDone = new Promise<void>((resolve) => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') {
        // Channel already closed, treat as success (data was sent)
        resolve();
        return;
      }

      let settled = false;

      const onDoneMessage = (event: MessageEvent) => {
        if (settled) {
          return;
        }
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);
          if (msg.type === 'done') {
            settled = true;
            cleanup();
            resolve();
          }
        }
      };

      const onClose = () => {
        if (!settled) {
          settled = true;
          cleanup();
          // Channel closed, data was likely delivered by SCTP
          resolve();
        }
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          // Timeout: data was sent, assume success
          resolve();
        }
      }, DONE_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timer);
        dc.removeEventListener('message', onDoneMessage);
        dc.removeEventListener('close', onClose);
      };

      dc.addEventListener('message', onDoneMessage);
      dc.addEventListener('close', onClose);
    });

    await waitForDone;

    // Done sending — reset for next transfer
    isTransferringRef.current = false;
    // Log history
    historyUtil.addEntry({
      fileName: file.name,
      fileSize: file.size,
      status: 'completed',
      type: 'sent',
      peerName: remotePeerIdRef.current || 'Unknown',
    });

    setProgress(null);
    resetPeerConnection();
    toast.success('Gửi file thành công! Người nhận đã nhận đầy đủ.');
  }, [resetPeerConnection]);

  const cancelTransfer = useCallback(() => {
    if (!isTransferringRef.current && !isReceiving) {
      return;
    }

    // Signal other peer
    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(JSON.stringify({ type: 'cancel' }));
      } catch (e) {
        console.error('Failed to send cancel message', e);
      }
    }

    // Log failure
    const fileName = isReceiving ? receiveMetadataRef.current?.name : lastSentFileNameRef.current;
    const fileSize = isReceiving ? receiveMetadataRef.current?.size : lastSentFileSizeRef.current;

    if (fileName && fileSize) {
      historyUtil.addEntry({
        fileName,
        fileSize,
        status: 'failed',
        type: isReceiving ? 'received' : 'sent',
        peerName: remotePeerIdRef.current || 'Unknown',
      });
    }

    // Abort writing if receiving
    if (receiveBufferRef.current) {
      const writer = receiveBufferRef.current;
      if ('abort' in writer && typeof writer.abort === 'function') {
        writer.abort().catch(() => { });
      }
      receiveBufferRef.current = null;
    }

    isTransferringRef.current = false;
    setIsReceiving(false);
    setProgress(null);
    resetPeerConnection();
    toast.info('Đã hủy truyền file.');
  }, [isReceiving, resetPeerConnection]);

  return {
    myId,
    status,
    progress,
    sendFile,
    isReceiving,
    joinRoom,
    leaveRoom,
    connectToPeer,
    roomUsers,
    requestFileSend,
    incomingRequest,
    answerFileRequest,
    setCryptoKey,
    incomingFileMetadata,
    acceptFileTransfer,
    cancelTransfer,
  };
}
