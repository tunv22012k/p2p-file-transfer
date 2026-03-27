import { useState, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { ConnectionStatus, FileMetadata, TransferProgress } from '@/types/webrtc';
import { WebRTCState, WritableStreamRef } from './types';

/**
 * Hook `useWebRTCState` đóng vai trò là "Kho chứa" (Single Source of Truth) cho ứng dụng P2P.
 * Thay vì để state phân tán ở nhiều hook, ta dồn tất cả `useState` và `useRef` vào đây.
 * Các hook con chỉ việc nhận Object `state` này và tương tác với nó (`pass-by-reference`).
 */
export function useWebRTCState(): WebRTCState {
  // ---- TRẠNG THÁI HIỂN THỊ (UI STATES) ----
  const [status, setStatus] = useState<ConnectionStatus>('Disconnected');
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Dùng cho UI hiển thị modal "Bạn nhận được một yêu cầu gửi file từ..." (Room Sharing)
  const [incomingRequest, setIncomingRequest] = useState<{ from: string; fromUsername: string; metadata: FileMetadata } | null>(null);

  // Dùng cho Link Sharing: khi tạo tự động giao dịch, đây là thông tin file để hỏi người dùng nơi lưu
  const [incomingFileMetadata, setIncomingFileMetadata] = useState<FileMetadata | null>(null);

  // ---- THÔNG TIN NGƯỜI DÙNG ----
  const [myId, setMyId] = useState<string>('');
  const [roomUsers, setRoomUsers] = useState<{ id: string; username: string }[]>([]);
  const [nearbyUsers, setNearbyUsers] = useState<{ id: string; username: string }[]>([]);

  // ---- REFERENCES (Lưu các state ngầm không làm re-render UI) ----
  const isTransferringRef = useRef<boolean>(false); // Đánh dấu cờ đang truyền file bảo mật
  const socketRef = useRef<Socket | null>(null);    // Kết nối websocket (Signaling)
  const pcRef = useRef<RTCPeerConnection | null>(null); // Trái tim WebRTC P2P

  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const lastSentFileNameRef = useRef<string | null>(null);
  const lastSentFileSizeRef = useRef<number | null>(null);
  const cryptoKeyRef = useRef<CryptoKey | null>(null);

  // ---- TẠM DỪNG / TIẾP TỤC (PAUSE/RESUME) ----
  const isPausedRef = useRef<boolean>(false);
  const activeFileRef = useRef<File | null>(null); // Lưu trữ file đang gửi lỡ cỡ để gửi tiếp
  const pausePromiseResolveRef = useRef<(() => void) | null>(null); // Thủ thuật Promise để chặn (block) vòng lặp gửi chunk

  // ---- QUẢN LÝ NHẬN FILE & BỘ NHỚ ĐỆM ----
  // receiveBufferRef là FileStream ghi trực tiếp vào ổ cứng người nhận (hạn chế RAM)
  const receiveBufferRef = useRef<WritableStreamRef | null>(null);
  const receiveMetadataRef = useRef<FileMetadata | null>(null);
  const receivedSizeRef = useRef<number>(0);
  const transferStartTime = useRef<number>(0);
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  return {
    status, setStatus,
    isSocketConnected, setIsSocketConnected,
    progress, setProgress,
    isReceiving, setIsReceiving,
    isPaused, setIsPaused,
    incomingRequest, setIncomingRequest,
    incomingFileMetadata, setIncomingFileMetadata,
    myId, setMyId,
    roomUsers, setRoomUsers,
    nearbyUsers, setNearbyUsers,
    isTransferringRef,
    socketRef,
    pcRef,
    dcRef,
    remotePeerIdRef,
    lastSentFileNameRef,
    lastSentFileSizeRef,
    cryptoKeyRef,
    isPausedRef,
    activeFileRef,
    pausePromiseResolveRef,
    receiveBufferRef,
    receiveMetadataRef,
    receivedSizeRef,
    transferStartTime,
    retryIntervalRef,
  };
}
