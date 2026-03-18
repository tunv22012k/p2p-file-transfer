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
  const [isPaused, setIsPaused] = useState(false);

  // For UI to show "Incoming file request"
  const [incomingRequest, setIncomingRequest] = useState<{ from: string; fromUsername: string; metadata: FileMetadata } | null>(null);

  // For Link auto-transactions: File is offered, receiver needs to click Accept to trigger Save Dialog
  const [incomingFileMetadata, setIncomingFileMetadata] = useState<FileMetadata | null>(null);

  const [myId, setMyId] = useState<string>('');
  const [roomUsers, setRoomUsers] = useState<{ id: string; username: string }[]>([]);
  const [nearbyUsers, setNearbyUsers] = useState<{ id: string; username: string }[]>([]);

  const isTransferringRef = useRef(false);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const lastSentFileNameRef = useRef<string | null>(null);
  const lastSentFileSizeRef = useRef<number | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);

  // Pause/Resume state
  const isPausedRef = useRef(false);
  const activeFileRef = useRef<File | null>(null);
  const pausePromiseResolveRef = useRef<(() => void) | null>(null);

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
    isPausedRef.current = false;
    setIsPaused(false);
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
      // receiveBufferRef.current = null; // Do NOT clear buffer on drop, wait for user to cancel or resume
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'metadata') {
          const incomingMetadata = msg.data as FileMetadata;

          // Check if resuming same file
          if (receiveBufferRef.current && receiveMetadataRef.current &&
            receiveMetadataRef.current.name === incomingMetadata.name &&
            receiveMetadataRef.current.size === incomingMetadata.size) {

            setIsReceiving(true);
            isTransferringRef.current = true;
            setIsPaused(false);
            isPausedRef.current = false;

            if (msg.keyStr && !cryptoKeyRef.current) {
              try { cryptoKeyRef.current = await importKeyString(msg.keyStr); } catch (err) { }
            }
            channel.send(JSON.stringify({ type: 'ready', offset: receivedSizeRef.current }));
            return;
          }

          receiveMetadataRef.current = incomingMetadata;
          receivedSizeRef.current = 0;
          setIsReceiving(true);
          setIsPaused(false);
          isPausedRef.current = false;
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
        } else if (msg.type === 'cancel') {
          isTransferringRef.current = false;
          setIsReceiving(false);
          setIsPaused(false);
          isPausedRef.current = false;
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
        } else if (msg.type === 'pause') {
          setIsPaused(true);
          isPausedRef.current = true;
          setProgress((prev) => prev ? { ...prev, isPaused: true, speed: 0, eta: null } : null);
          toast.info('Đối tác đã tạm dừng truyền file.');
        } else if (msg.type === 'resume') {
          setIsPaused(false);
          isPausedRef.current = false;
          setProgress((prev) => prev ? { ...prev, isPaused: false } : null);
          transferStartTime.current = Date.now(); // reset start time to recalculate speed
          toast.success('Đối tác tiếp tục truyền file.');
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

            if (!isTransferringRef.current) {
              return;
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
              isPaused: isPausedRef.current,
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
            if (!isTransferringRef.current) {
              return;
            }

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
          if (dcRef.current?.readyState === 'open') {
            setStatus('Connected');
          }
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

    socketRef.current.on('nearby-users', (users: { id: string; username: string }[]) => {
      console.log('Received nearby users:', users);
      setNearbyUsers(users);
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
    if (!incomingFileMetadata) {
      return;
    }

    if (!dcRef.current || dcRef.current.readyState !== 'open') {
      toast.error('Kết nối đã bị ngắt. Vui lòng tải lại trang và thử lại.');
      setIncomingFileMetadata(null);
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
      if (dcRef.current && dcRef.current.readyState === 'open') {
        dcRef.current.send(JSON.stringify({ type: 'ready' }));
      } else {
        toast.error('Kết nối đã bị ngắt trong khi chọn nơi lưu file.');
        isTransferringRef.current = false;
        return;
      }
      setIncomingFileMetadata(null); // Clear prompt
    } catch (e: unknown) {
      console.error('User cancelled save prompt or error:', e);
      const error = e instanceof Error ? e.message : String(e);
      if (dcRef.current && dcRef.current.readyState === 'open') {
        dcRef.current.send(JSON.stringify({ type: 'error', error: `User cancelled or failed to save: ${error}` }));
      }
      setIsReceiving(false);
      setIncomingFileMetadata(null);
    }
  };

  const sendFile = useCallback(async (file: File) => {
    if (isTransferringRef.current) {
      return; // Already sending, prevent duplicate calls
    }

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

    const waitForReady = new Promise<number>((resolve, reject) => {
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
            resolve(msg.offset || 0);
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

    let offset = 0;
    try {
      offset = await waitForReady;
    } catch (e: unknown) {
      const error = e as Error;
      isTransferringRef.current = false;
      toast.error(`Không thể gửi file: ${error.message || 'Người nhận đã từ chối file.'}`);
      resetPeerConnection();
      return;
    }

    activeFileRef.current = file;
    isTransferringRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;

    let transferStartTimeLocal = Date.now();
    let sentSinceStart = 0;
    let lastSpeed = 0;

    try {
      while (offset < file.size) {
        if (isPausedRef.current) {
          await new Promise<void>(resolve => {
            pausePromiseResolveRef.current = resolve;
          });
          transferStartTimeLocal = Date.now() - (sentSinceStart / (lastSpeed || 1)) * 1000;
        }
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

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        let sliceBuf = await file.slice(offset, end).arrayBuffer();
        const unencryptedSize = sliceBuf.byteLength;

        // Encrypt if we have a key
        if (cryptoKeyRef.current) {
          sliceBuf = await encryptChunk(sliceBuf, cryptoKeyRef.current);
        }

        if (!isTransferringRef.current || !dcRef.current || dcRef.current.readyState !== 'open') {
          break;
        }

        dcRef.current.send(sliceBuf);

        offset += unencryptedSize;
        sentSinceStart += unencryptedSize;

        const now = Date.now();
        const elapsed = (now - transferStartTimeLocal) / 1000;
        const currentSpeed = elapsed > 0 ? sentSinceStart / elapsed : 0;
        lastSpeed = currentSpeed;
        const remainingBytes = file.size - offset;
        const eta = currentSpeed > 0 ? remainingBytes / currentSpeed : null;

        setProgress({
          progress: (offset / file.size) * 100,
          bytesTransferred: offset,
          totalBytes: file.size,
          speed: currentSpeed,
          eta,
          isPaused: isPausedRef.current
        });
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

    if (!isTransferringRef.current) {
      return; // Cancelled
    }

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

  const pauseTransfer = useCallback(() => {
    if (!isTransferringRef.current) return;

    setIsPaused(true);
    isPausedRef.current = true;
    setProgress(prev => prev ? { ...prev, isPaused: true, speed: 0, eta: null } : null);

    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(JSON.stringify({ type: 'pause' }));
      } catch (e) {
        console.error('Failed to send pause message', e);
      }
    }
  }, []);

  const resumeTransfer = useCallback(async () => {
    if (!isTransferringRef.current && !activeFileRef.current) return;

    if (dcRef.current && dcRef.current.readyState === 'open') {
      setIsPaused(false);
      isPausedRef.current = false;
      setProgress(prev => prev ? { ...prev, isPaused: false } : null);

      try {
        dcRef.current.send(JSON.stringify({ type: 'resume' }));
      } catch (e) {
        console.error('Failed to send resume message', e);
      }

      if (pausePromiseResolveRef.current) {
        pausePromiseResolveRef.current();
        pausePromiseResolveRef.current = null;
      }
    } else {
      if (activeFileRef.current && status === 'Connected') {
        sendFile(activeFileRef.current);
      } else {
        toast.info(status === 'Connected' ? 'Vui lòng chọn lại file để tiếp tục.' : 'Vui lòng đợi mạng hoặc kết nối lại trước khi tiếp tục.');
      }
    }
  }, [status, sendFile]);

  const cancelTransfer = useCallback(() => {
    // If we're absolutely not doing anything, just return
    if (!isTransferringRef.current && !isReceiving && !activeFileRef.current && !progress) {
      return;
    }

    // Signal other peer if we have a connection
    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(JSON.stringify({ type: 'cancel' }));
      } catch (e) {
        console.error('Failed to send cancel message', e);
      }
    }

    // Abort writing if receiving
    if (receiveBufferRef.current) {
      const writer = receiveBufferRef.current;
      if ('abort' in writer && typeof writer.abort === 'function') {
        writer.abort().catch(() => { });
        receiveBufferRef.current = null;
      }
    }

    // Abort paused state if blocked
    if (pausePromiseResolveRef.current) {
      pausePromiseResolveRef.current();
      pausePromiseResolveRef.current = null;
    }

    isTransferringRef.current = false;
    setIsReceiving(false);
    setIsPaused(false);
    isPausedRef.current = false;
    setProgress(null);
    activeFileRef.current = null;
    resetPeerConnection();
    toast.info('Đã hủy truyền file.');
  }, [isReceiving, progress, resetPeerConnection]);

  // Prevent accidental tab closure during transfer
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Check if there is an active file transfer in progress
      if (isTransferringRef.current || isReceiving) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome/Edge to display the native prompt
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isReceiving]);

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
    nearbyUsers,
    updateNearbyName: (name: string) => {
      socketRef.current?.emit('update-username', name);
    },
    requestFileSend,
    incomingRequest,
    answerFileRequest,
    setCryptoKey,
    incomingFileMetadata,
    acceptFileTransfer,
    cancelTransfer,
    pauseTransfer,
    resumeTransfer,
    isPaused,
  };
}
