import { useCallback } from 'react';
import { fetchIceServers } from '@/lib/webrtc-config';
import { decryptChunk, importKeyString } from '@/lib/crypto';
import { historyUtil } from '@/lib/history';
import { toast } from 'sonner';
import { WebRTCState } from './types';
import { FileMetadata } from '@/types/webrtc';

/**
 * Hook `useWebRTCConnection` phụ trách thiết lập kết nối peer-to-peer (P2P) cốt lõi nhất.
 * Nó khởi tạo `RTCPeerConnection`, quản lý ICE Servers (chui qua tường lửa),
 * và thiết lập mương dữ liệu `RTCDataChannel` dùng để phân phối dữ liệu file tốc độ cao.
 */
export function useWebRTCConnection(state: WebRTCState) {
  const {
    dcRef, pcRef, remotePeerIdRef, cryptoKeyRef, isTransferringRef,
    isPausedRef, setIsPaused, lastSentFileNameRef, lastSentFileSizeRef,
    socketRef, setStatus, receiveBufferRef, receiveMetadataRef,
    receivedSizeRef, setIsReceiving, transferStartTime,
    setIncomingFileMetadata, setProgress
  } = state;

  /**
   * Đóng sạch sẽ các kết nối hiện tại và đưa trạng thái State về ban đầu
   */
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
  }, [dcRef, pcRef, remotePeerIdRef, cryptoKeyRef, isTransferringRef, isPausedRef, setIsPaused, lastSentFileNameRef, lastSentFileSizeRef]);

  /**
   * Cấu hình Ống dẫn dữ liệu (Data Channel).
   * Lắng nghe các sự kiện nhận file (.onmessage), mã hóa và ghi trực tiếp vào ổ cứng người nhận.
   */
  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dcRef.current = channel;
    // Bắt buộc cấu hình arraybuffer để truyền tải file nhị phân (Binary)
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      if (pcRef.current?.connectionState === 'connected' || pcRef.current?.connectionState === 'connecting') {
        setStatus('Connected');
      }
    };

    channel.onclose = () => {
      setStatus('Disconnected');
    };

    // Khi có tin nhắn đến từ peer bên kia
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
            channel.send(JSON.stringify({ type: 'ready' }));
          } else {
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
          transferStartTime.current = Date.now();
          toast.success('Đối tác tiếp tục truyền file.');
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Nhận dữ liệu thực tế (các khung dữ liệu mảnh / chunk)
        if (receiveBufferRef.current && receiveMetadataRef.current) {
          try {
            let chunkBuf = event.data;
            // Tiến hành giải mã nếu luồng kết nối được yêu cầu bảo mật
            if (cryptoKeyRef.current) {
              chunkBuf = await decryptChunk(chunkBuf, cryptoKeyRef.current);
            }

            // Ghi mảnh file vào Stream (ổ cứng) thay vì dồn vào RAM
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
              const buf = receiveBufferRef.current;
              if ('close' in buf && typeof buf.close === 'function') {
                await buf.close();
              }
              receiveBufferRef.current = null;
              setIsReceiving(false);
              setProgress(null);
              isTransferringRef.current = false;
              if (channel.readyState === 'open') {
                channel.send(JSON.stringify({ type: 'done' }));
              }
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
  }, [
    dcRef, pcRef, receiveBufferRef, receiveMetadataRef, receivedSizeRef,
    setIsReceiving, isTransferringRef, setIsPaused, isPausedRef,
    cryptoKeyRef, transferStartTime, setIncomingFileMetadata,
    setProgress, resetPeerConnection, remotePeerIdRef, setStatus
  ]);

  /**
   * Khởi tạo WebRTC từ zero: Lấy ICE Servers (coturn/cloudflare) để có khả năng
   * vượt Tường lửa (Firewall) hoặc NAT, sau đó mới tạo RTCPeerConnection mới.
   */
  const initWebRTC = useCallback(async () => {
    if (pcRef.current) {
      const pState = pcRef.current.connectionState;
      if (pState === 'closed' || pState === 'failed' || pState === 'disconnected') {
        pcRef.current.close();
        pcRef.current = null;
        dcRef.current = null;
      } else {
        return pcRef.current;
      }
    }

    const iceConfig = await fetchIceServers(socketRef.current);
    const pc = new RTCPeerConnection(iceConfig);
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
  }, [pcRef, dcRef, socketRef, setStatus, remotePeerIdRef, setupDataChannel]);

  return {
    resetPeerConnection,
    setupDataChannel,
    initWebRTC
  };
}
