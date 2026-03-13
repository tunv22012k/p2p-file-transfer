export const RTC_ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Cloudflare TURN server can be added here if you have credentials:
    // {
    //   urls: 'turn:turn.cloudflare.com:3478',
    //   username: '...',
    //   credential: '...'
    // }
  ],
};

export const CHUNK_SIZE = 64 * 1024; // 64 KB

// When more than 64 MB is buffered, we pause sending.
export const MAX_BUFFERED_AMOUNT = 64 * 1024 * 1024; // 64 MB
