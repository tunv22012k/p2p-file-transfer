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

// When buffer is full, pause sending.
// Browsers usually have a 16MB hard limit on the send queue, so we pause at 8MB to be safe.
export const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8 MB
