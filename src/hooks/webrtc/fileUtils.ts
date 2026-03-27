import { WritableStreamRef } from './types';

// ─── Fallback for browsers that don't support showSaveFilePicker (Firefox, Safari) ───

export async function saveFileFallback(fileName: string): Promise<WritableStreamRef> {
  if ('showSaveFilePicker' in window) {
    // Chrome / Edge: native file picker
    // @ts-expect-error - showSaveFilePicker is not in all browsers' window type yet
    const handle = await window.showSaveFilePicker({ suggestedName: fileName });
    return handle.createWritable();
  }

  // Firefox / Safari fallback: collect chunks in memory, then download via <a>
  const chunks: BlobPart[] = [];
  return new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk as unknown as BlobPart);
    },
    close() {
      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    },
  }) as unknown as WritableStreamRef;
}
