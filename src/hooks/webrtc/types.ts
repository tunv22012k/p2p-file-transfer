import { Socket } from 'socket.io-client';
import { ConnectionStatus, FileMetadata, TransferProgress } from '@/types/webrtc';

export type WritableStreamRef = WritableStreamDefaultWriter | FileSystemWritableFileStream | WritableStream<Uint8Array>;

export interface WebRTCState {
  status: ConnectionStatus;
  setStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  isSocketConnected: boolean;
  setIsSocketConnected: React.Dispatch<React.SetStateAction<boolean>>;
  progress: TransferProgress | null;
  setProgress: React.Dispatch<React.SetStateAction<TransferProgress | null>>;
  isReceiving: boolean;
  setIsReceiving: React.Dispatch<React.SetStateAction<boolean>>;
  isPaused: boolean;
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>;

  incomingRequest: { from: string; fromUsername: string; metadata: FileMetadata } | null;
  setIncomingRequest: React.Dispatch<React.SetStateAction<{ from: string; fromUsername: string; metadata: FileMetadata } | null>>;

  incomingFileMetadata: FileMetadata | null;
  setIncomingFileMetadata: React.Dispatch<React.SetStateAction<FileMetadata | null>>;

  myId: string;
  setMyId: React.Dispatch<React.SetStateAction<string>>;
  roomUsers: { id: string; username: string }[];
  setRoomUsers: React.Dispatch<React.SetStateAction<{ id: string; username: string }[]>>;
  nearbyUsers: { id: string; username: string }[];
  setNearbyUsers: React.Dispatch<React.SetStateAction<{ id: string; username: string }[]>>;

  // Refs
  isTransferringRef: React.MutableRefObject<boolean>;
  socketRef: React.MutableRefObject<Socket | null>;
  pcRef: React.MutableRefObject<RTCPeerConnection | null>;
  dcRef: React.MutableRefObject<RTCDataChannel | null>;
  remotePeerIdRef: React.MutableRefObject<string | null>;
  lastSentFileNameRef: React.MutableRefObject<string | null>;
  lastSentFileSizeRef: React.MutableRefObject<number | null>;
  cryptoKeyRef: React.MutableRefObject<CryptoKey | null>;

  // Pause/Resume state
  isPausedRef: React.MutableRefObject<boolean>;
  activeFileRef: React.MutableRefObject<File | null>;
  pausePromiseResolveRef: React.MutableRefObject<(() => void) | null>;

  // Transfer state
  receiveBufferRef: React.MutableRefObject<WritableStreamRef | null>;
  receiveMetadataRef: React.MutableRefObject<FileMetadata | null>;
  receivedSizeRef: React.MutableRefObject<number>;
  transferStartTime: React.MutableRefObject<number>;
  retryIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
}
