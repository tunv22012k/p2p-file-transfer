export interface FileMetadata {
  name: string;
  size: number;
  type: string;
}

export type SignalingMessage =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit; from: string; to: string }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit; from: string; to: string }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit; from: string; to: string }
  | { type: 'peer-join'; peerId: string }
  | { type: 'peer-leave'; peerId: string };

export interface TransferProgress {
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number | null; // estimated seconds remaining
  isPaused?: boolean;
}

export type ConnectionStatus = 'Disconnected' | 'Connecting' | 'Connected' | 'Error';

export interface TransferHistoryItem {
  id: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  status: 'completed' | 'failed';
  type: 'sent' | 'received';
  peerName?: string;
}
