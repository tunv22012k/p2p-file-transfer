import * as fflate from 'fflate';

/**
 * Read a File as a Uint8Array 
 */
function readFileAsUint8Array(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Packs a list of files into a single .zip File in memory.
 * Preserves relative paths if the File object has a `webkitRelativePath`.
 * 
 * @param files - array of File objects to zip (may have webkitRelativePath set by directory picker)
 * @param zipName - the name for the resulting .zip file (without extension)
 * @returns a new File object with MIME type 'application/zip'
 */
export async function zipFiles(files: File[], zipName = 'files'): Promise<File> {
  const zipInput: fflate.Zippable = {};

  for (const file of files) {
    const data = await readFileAsUint8Array(file);
    // Preserve folder structure if available (via webkitdirectory picker)
    const path = file.webkitRelativePath || file.name;
    // fflate expects nested objects for folders, but we can just use flat paths with /
    zipInput[path] = data;
  }

  return new Promise<File>((resolve, reject) => {
    fflate.zip(zipInput, { level: 0 }, (err, zipped) => {
      if (err) {
        reject(err);
        return;
      }
      const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
      resolve(new File([blob], `${zipName}.zip`, { type: 'application/zip' }));
    });
  });
}

/**
 * Returns a human-readable size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
