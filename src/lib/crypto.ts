// Web Crypto API utility for AES-GCM encryption

// Generate a random 256-bit AES key and export it as a base64 string for URL sharing
export async function generateKeyString(): Promise<string> {
  const key = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
  
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Import a base64 string back into a CryptoKey
export async function importKeyString(keyStr: string): Promise<CryptoKey> {
  // Add padding back if needed
  let base64 = keyStr.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  
  return window.crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a chunk of data. Returns the encrypted buffer with IV prepended.
export async function encryptChunk(chunk: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  // Generate a random 12-byte IV for every chunk
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    chunk
  );

  // Prepend IV to ciphertext (12 bytes + ciphertext length)
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  
  return result.buffer;
}

// Decrypt a chunk of data. Expects the IV to be prepended to the ciphertext.
export async function decryptChunk(encryptedChunk: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const data = new Uint8Array(encryptedChunk);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);

  return window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    key,
    ciphertext
  );
}
