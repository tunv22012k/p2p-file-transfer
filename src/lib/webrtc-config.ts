import type { Socket } from 'socket.io-client';

export async function fetchIceServers(socket: Socket | null): Promise<RTCConfiguration> {
  // Always include free Google STUN servers
  const stun: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (!socket?.connected) {
    console.warn('[ICE] Socket not connected, using STUN-only');
    return { iceServers: stun };
  }

  try {
    // Fetch TURN credentials through socket.io (same connection that's already working)
    const data = await new Promise<{ iceServers?: { urls: string[]; username: string; credential: string }; error?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      socket.emit('get-turn-credentials', (response: { iceServers?: { urls: string[]; username: string; credential: string }; error?: string }) => {
        clearTimeout(timeout);
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });

    if (data.iceServers) {
      console.log('[ICE] Got TURN credentials via socket.io:', {
        urls: data.iceServers.urls,
        username: data.iceServers.username ? '***' : 'MISSING',
        credential: data.iceServers.credential ? '***' : 'MISSING',
      });
      return { iceServers: [...stun, data.iceServers] };
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
