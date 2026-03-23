const SIGNALING_SERVER_URL =
  typeof window !== 'undefined'
    ? window.location.hostname === 'localhost'
      ? 'http://localhost:3001'
      : process.env.NEXT_PUBLIC_SIGNALING_URL || window.location.origin
    : 'http://localhost:3001';

export async function fetchIceServers(): Promise<RTCConfiguration> {
  // Always include free Google STUN servers
  const stun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  try {
    const res = await fetch(`${SIGNALING_SERVER_URL}/turn-credentials`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    // Cloudflare returns { iceServers: { urls: [...], username, credential } }
    const turnServer = data.iceServers;
    if (turnServer) {
      console.log('[ICE] Fetched dynamic TURN credentials');
      return { iceServers: [...stun, turnServer] };
    }
  } catch (err) {
    console.warn('[ICE] Failed to fetch TURN credentials, using STUN-only:', err);
  }

  // Fallback: STUN-only (works on same LAN, may fail cross-network)
  return { iceServers: stun };
}

export const CHUNK_SIZE = 64 * 1024; // 64 KB

// When buffer is full, pause sending.
// Browsers usually have a 16MB hard limit on the send queue, so we pause at 8MB to be safe.
export const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8 MB
