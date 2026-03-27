import { useCallback } from 'react';
import { toast } from 'sonner';
import { historyUtil } from '@/lib/history';
import { encryptChunk, generateKeyString, importKeyString } from '@/lib/crypto';
import { CHUNK_SIZE, MAX_BUFFERED_AMOUNT } from '@/lib/webrtc-config';
import { WebRTCState } from './types';
import { FileMetadata } from '@/types/webrtc';
import { saveFileFallback } from './fileUtils';

const READY_TIMEOUT_MS = 60_000;
const DONE_TIMEOUT_MS = 30_000;

/**
 * Hook `useFileTransfer` chịu trách nhiệm toàn bộ quá trình đóng gói và gửi/nhận file.
 * Xử lý: gửi Metadata, băm nhỏ file ra thành các cục (chunks), mã hóa (encrypt), 
 * gửi qua DataChannel, tạm dừng (pause), tiếp tục (resume), và hủy (cancel).
 */
export function useFileTransfer(
  state: WebRTCState,
  resetPeerConnection: () => void
) {
  const {
    dcRef, cryptoKeyRef, isTransferringRef, isPausedRef, setIsPaused,
    lastSentFileNameRef, lastSentFileSizeRef, activeFileRef,
    pausePromiseResolveRef, setProgress, remotePeerIdRef,
    incomingFileMetadata, setIncomingFileMetadata, receiveBufferRef,
    setIsReceiving, status, isReceiving, progress
  } = state;

  /**
   * Bước 2 của quá trình nhận: Người dùng ấn "Chấp nhận" tải file.
   * Xử lý gọi File System Access API để lấy quyền ghi ổ cứng, sau đó báo `ready`.
   */
  const acceptFileTransfer = useCallback(async () => {
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
      setIncomingFileMetadata(null);
    } catch (e: unknown) {
      console.error('User cancelled save prompt or error:', e);
      const error = e instanceof Error ? e.message : String(e);
      if (dcRef.current && dcRef.current.readyState === 'open') {
        dcRef.current.send(JSON.stringify({ type: 'error', error: `User cancelled or failed to save: ${error}` }));
      }
      setIsReceiving(false);
      setIncomingFileMetadata(null);
    }
  }, [incomingFileMetadata, dcRef, isTransferringRef, receiveBufferRef, setIncomingFileMetadata, setIsReceiving]);

  /**
   * Hàm P2P chính: Gửi file từ máy này sang máy khác qua WebRTC DataChannel.
   * Quy trình: Gửi thông tin (Metadata) -> Chờ phản hồi `ready` -> Bốc từng dòng byte gửi đi -> Gửi tín hiệu hoàn tất.
   */
  const sendFile = useCallback(async (file: File) => {
    if (isTransferringRef.current) {
      return;
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

    // Khởi tạo khóa mã hóa AES-GCM chuyên dụng cho phiên làm việc này để chống bị nghe lén
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

    // Vòng lặp quan trọng nhất: Chia nhỏ file thành các đoạn CHUNK_SIZE và tiến hành bơm vào ống
    try {
      while (offset < file.size) {
        // Tạm dừng: Đợi Promise block vòng lặp ở đây cho đến khi có người gọi resolve()
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

        // Đọc 1 đoạn file bằng slice() để không đưa toàn bộ file vào RAM gây tràn bộ nhớ (OOM)
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        let sliceBuf = await file.slice(offset, end).arrayBuffer();
        const unencryptedSize = sliceBuf.byteLength;

        // Tiến hành mã hóa chunk
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
          resolve();
        }
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
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
      return;
    }

    isTransferringRef.current = false;
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
  }, [dcRef, isTransferringRef, lastSentFileNameRef, lastSentFileSizeRef, cryptoKeyRef, activeFileRef, setIsPaused, isPausedRef, pausePromiseResolveRef, setProgress, remotePeerIdRef, resetPeerConnection]);

  /**
   * Tạm dừng quá trình gửi tín hiệu DataChannel, và bật cờ `isPaused`
   * làm cho vòng lặp chunk reader bên gửi ngừng đút thêm data vào ống.
   */
  const pauseTransfer = useCallback(() => {
    if (!isTransferringRef.current) {
      return;
    }

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
  }, [isTransferringRef, setIsPaused, isPausedRef, setProgress, dcRef]);

  /**
   * Hủy bỏ tạm dừng, truyền lệnh tiếp tục tới peer bên kia 
   * và tháo chốt (resolve Promise) để vòng lặp while(offset < file.size) chạy tiếp.
   */
  const resumeTransfer = useCallback(async () => {
    if (!isTransferringRef.current && !activeFileRef.current) {
      return;
    }

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
  }, [isTransferringRef, activeFileRef, dcRef, setIsPaused, isPausedRef, setProgress, pausePromiseResolveRef, status, sendFile]);

  /**
   * Hủy luồng truyền file ngay lập tức, báo cho peer bên kia qua thẻ metadata Cancel
   * và xóa bỏ file ghi giở (nếu đang nhận nửa chừng).
   */
  const cancelTransfer = useCallback(() => {
    if (!isTransferringRef.current && !isReceiving && !activeFileRef.current && !progress) {
      return;
    }

    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(JSON.stringify({ type: 'cancel' }));
      } catch (e) {
        console.error('Failed to send cancel message', e);
      }
    }

    if (receiveBufferRef.current) {
      const writer = receiveBufferRef.current;
      if ('abort' in writer && typeof writer.abort === 'function') {
        writer.abort().catch(() => { });
        receiveBufferRef.current = null;
      }
    }

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
  }, [isTransferringRef, isReceiving, activeFileRef, progress, dcRef, receiveBufferRef, pausePromiseResolveRef, setIsReceiving, setIsPaused, isPausedRef, setProgress, resetPeerConnection]);

  return {
    sendFile,
    acceptFileTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer
  };
}
