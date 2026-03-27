import { useEffect } from 'react';
import { useWebRTCState } from './useWebRTCState';
import { useWebRTCConnection } from './useWebRTCConnection';
import { useSignaling } from './useSignaling';
import { useFileTransfer } from './useFileTransfer';

/**
 * Hook `useWebRTC` chính đóng vai trò là nhạc trưởng (Orchestrator / Facade).
 * Nó gộp chung state và tất cả các logic từ các hooks con (`useWebRTCConnection`, 
 * `useSignaling`, `useFileTransfer`) và export ra dưới dạng một Interface duy nhất.
 * Nhờ cấu trúc này, UI ở ngoài không cần biết bên trong chia nhỏ thế nào, 
 * và mã nguồn hook chính trở nên rất gọn nhẹ, dễ bảo trì.
 */
export function useWebRTC() {
  const state = useWebRTCState();

  const { resetPeerConnection, setupDataChannel, initWebRTC } = useWebRTCConnection(state);

  const {
    joinRoom,
    leaveRoom,
    connectToPeer,
    updateNearbyName,
    requestFileSend,
    answerFileRequest
  } = useSignaling(state, initWebRTC, setupDataChannel, resetPeerConnection);

  const {
    sendFile,
    acceptFileTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer
  } = useFileTransfer(state, resetPeerConnection);

  // ---- EFFECTS CHUNG ----
  // Ngăn chặn người dùng vô tình đóng tab/trình duyệt khi đang truyền/nhận file
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.isTransferringRef.current || state.isReceiving) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isReceiving, state.isTransferringRef]);

  return {
    myId: state.myId,
    status: state.status,
    isSocketConnected: state.isSocketConnected,
    progress: state.progress,
    sendFile,
    isReceiving: state.isReceiving,
    joinRoom,
    leaveRoom,
    connectToPeer,
    roomUsers: state.roomUsers,
    nearbyUsers: state.nearbyUsers,
    updateNearbyName,
    requestFileSend,
    incomingRequest: state.incomingRequest,
    answerFileRequest,
    setCryptoKey: (key: CryptoKey) => {
      state.cryptoKeyRef.current = key;
    },
    incomingFileMetadata: state.incomingFileMetadata,
    acceptFileTransfer,
    cancelTransfer,
    pauseTransfer,
    resumeTransfer,
    isPaused: state.isPaused,
  };
}
