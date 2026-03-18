export const RTC_ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp'
      ],
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || '49d3952601da5078f1fb9f13875f6dcb',
      credential: process.env.NEXT_PUBLIC_TURN_PASSWORD || '3fd4eb2b4b139938f754eaa5cda88416d50f415e3d0ad3f76dfec20d035d3bd7'
    }
  ],
};

export const CHUNK_SIZE = 64 * 1024; // 64 KB

// When buffer is full, pause sending.
// Browsers usually have a 16MB hard limit on the send queue, so we pause at 8MB to be safe.
export const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8 MB
