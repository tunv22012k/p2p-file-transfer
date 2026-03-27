import { useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { WebRTCState } from './types';
import { FileMetadata } from '@/types/webrtc';
import { saveFileFallback } from './fileUtils';

const SIGNALING_SERVER_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

/**
 * Hook `useSignaling` đảm nhiệm toàn bộ giao tiếp với Socket.io.
 * Signaling là quá trình hai trình duyệt "người mù" tìm thấy nhau qua Internet 
 * bằng cách trao đổi thư (SDP/ICE) thông qua một Server trung gian (NodeJS).
 */
export function useSignaling(
  state: WebRTCState,
  initWebRTC: () => Promise<RTCPeerConnection | null>,
  setupDataChannel: (channel: RTCDataChannel) => void,
  resetPeerConnection: () => void
) {
  const {
    socketRef, pcRef, dcRef, setIsSocketConnected, setMyId, setNearbyUsers,
    setRoomUsers, remotePeerIdRef, setIncomingRequest, setIsReceiving,
    isTransferringRef, transferStartTime, receiveBufferRef, receiveMetadataRef,
    receivedSizeRef, incomingRequest, retryIntervalRef
  } = state;

  useEffect(() => {
    // 1. Khởi tạo kết nối tới Signaling Server
    socketRef.current = io(SIGNALING_SERVER_URL);

    socketRef.current.on('connect', () => {
      setIsSocketConnected(true);
    });

    socketRef.current.on('disconnect', () => {
      setIsSocketConnected(false);
    });

    const handleIceFallback = (e: Event) => {
      const customEvent = e as CustomEvent;
      console.warn('ICE Fallback event:', customEvent.detail);
      toast.error('Lỗi lấy máy chủ TURN (Relay). Vui lòng kiểm tra lại cấu hình.');
    };
    window.addEventListener('ice-fallback', handleIceFallback);

    // 2. Lắng nghe thông tin định danh và phòng
    socketRef.current.on('your-id', (id) => {
      setMyId(id);
    });

    socketRef.current.on('nearby-users', (users: { id: string; username: string }[]) => {
      console.log('Received nearby users:', users);
      setNearbyUsers(users);
    });

    socketRef.current.on('room-users', (users: { id: string; username: string }[]) => {
      setRoomUsers((prevUsers) => {
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

    // 3. Quy trình Bắt tay WebRTC (Signaling Protocol)
    
    // 3a. Nhận yêu cầu kết nối trực tiếp (Link Sharing)
    socketRef.current.on('incoming-direct-connection', async (peerId) => {
      remotePeerIdRef.current = peerId;
      const pc = await initWebRTC();
      if (!pc) {
        return;
      }
      const dc = pc.createDataChannel('fileTransfer');
      setupDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current?.emit('offer', {
        to: peerId,
        sdp: { type: offer.type, sdp: offer.sdp },
      });
    });

    // 3b. Nhận một Offer SDP từ Peer khác để rủ kết nối
    socketRef.current.on('offer', async (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      remotePeerIdRef.current = data.from;
      const pc = await initWebRTC();
      if (!pc) {
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit('answer', {
        to: data.from,
        sdp: { type: answer.type, sdp: answer.sdp },
      });
    });

    // 3c. Nhận lại Answer trả lời cho Offer vừa tạo
    socketRef.current.on('answer', async (data: { sdp: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    });

    // 3d. Nhận và bổ sung các ICE Candidates (Ứng cử viên địa chỉ mạng IP/Port)
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

    // 4. Nhận thông báo mời gửi file (Room Sharing)
    socketRef.current.on('file-request', (data: { from: string; fromUsername?: string; metadata: FileMetadata }) => {
      setIncomingRequest({
        from: data.from,
        fromUsername: data.fromUsername || data.from,
        metadata: data.metadata,
      });
    });

    // Cleanup khi Unmount Hook
    return () => {
      window.removeEventListener('ice-fallback', handleIceFallback);
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
      socketRef.current?.disconnect();
      pcRef.current?.close();
      dcRef.current?.close();
    };
  }, [
    initWebRTC, setupDataChannel, setIsSocketConnected, setMyId, setNearbyUsers,
    setRoomUsers, setIncomingRequest, socketRef, pcRef, dcRef, remotePeerIdRef,
    retryIntervalRef
  ]);

  const joinRoom = useCallback((roomId: string, username?: string) => {
    socketRef.current?.emit('join-room', { roomId, username });
  }, [socketRef]);

  const leaveRoom = useCallback(() => {
    resetPeerConnection();
  }, [resetPeerConnection]);

  const connectToPeer = useCallback((peerId: string) => {
    if (retryIntervalRef.current) {
      clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }

    let attempts = 0;
    const maxAttempts = 10;

    const tryConnect = () => {
      if (!socketRef.current?.connected) {
        console.log('[connectToPeer] Socket not connected, will retry...');
        return;
      }

      attempts++;
      console.log(`[connectToPeer] Attempt ${attempts}/${maxAttempts} to connect to ${peerId}`);

      socketRef.current.emit('request-direct-connection', peerId, (response: { ok: boolean; error?: string }) => {
        if (response?.ok) {
          console.log('[connectToPeer] Target found, connection forwarded');
          if (retryIntervalRef.current) {
            clearInterval(retryIntervalRef.current);
            retryIntervalRef.current = null;
          }
        } else {
          console.log(`[connectToPeer] Target not found (attempt ${attempts}/${maxAttempts})`);
          if (attempts >= maxAttempts && retryIntervalRef.current) {
            clearInterval(retryIntervalRef.current);
            retryIntervalRef.current = null;
            toast.error('Không tìm thấy người gửi. Link có thể đã hết hạn, hãy yêu cầu link mới.');
          }
        }
      });
    };

    tryConnect();
    retryIntervalRef.current = setInterval(tryConnect, 3000);
  }, [socketRef, retryIntervalRef]);

  const updateNearbyName = useCallback((name: string) => {
    socketRef.current?.emit('update-username', name);
  }, [socketRef]);

  const requestFileSend = useCallback((targetPeerId: string, metadata: FileMetadata) => {
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

          remotePeerIdRef.current = targetPeerId;
          const pc = await initWebRTC();
          if (!pc) {
            return resolve(false);
          }

          const dc = pc.createDataChannel('fileTransfer');
          setupDataChannel(dc);

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
  }, [isTransferringRef, socketRef, resetPeerConnection, initWebRTC, setupDataChannel, remotePeerIdRef]);

  const answerFileRequest = useCallback(async (accept: boolean) => {
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

        socketRef.current?.emit('file-request-accepted', { to: incomingRequest.from });
      } catch (e) {
        console.error('User cancelled picker or error:', e);
        socketRef.current?.emit('file-request-rejected', { to: incomingRequest.from });
        setIncomingRequest(null);
        return;
      }
    } else {
      socketRef.current?.emit('file-request-rejected', { to: incomingRequest.from });
    }
    setIncomingRequest(null);
  }, [incomingRequest, isTransferringRef, socketRef, setIncomingRequest, receiveBufferRef, receiveMetadataRef, receivedSizeRef, setIsReceiving, transferStartTime]);

  return {
    joinRoom,
    leaveRoom,
    connectToPeer,
    updateNearbyName,
    requestFileSend,
    answerFileRequest
  };
}
