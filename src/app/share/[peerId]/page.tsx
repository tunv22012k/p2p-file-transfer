'use client';

import { useWebRTC } from '@/hooks/useWebRTC';
import { importKeyString } from '@/lib/crypto';
import { Download, Loader2, XCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function ShareReceiverPage() {
  const {
    status, progress, connectToPeer, setCryptoKey, isSocketConnected,
    incomingFileMetadata, acceptFileTransfer,
    cancelTransfer, pauseTransfer, resumeTransfer, isPaused
  } = useWebRTC();
  const pathname = usePathname();
  const [error, setError] = useState('');

  // Extract Target Peer ID and Crypto Key on load
  useEffect(() => {
    if (!isSocketConnected) {
      return; // Chờ socket.io kết nối xong
    }

    const targetPeerId = pathname.split('/').pop();
    const hash = window.location.hash.slice(1);

    if (!targetPeerId || !hash) {
      setError('Đường dẫn không hợp lệ. Thiếu mã kết nối hoặc khóa giải mã.');
      return;
    }

    importKeyString(hash)
      .then(key => {
        setCryptoKey(key);
        connectToPeer(targetPeerId);
      })
      .catch(err => {
        console.error("Failed to import key:", err);
        setError('Khóa giải mã trong URL không hợp lệ.');
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, isSocketConnected]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl text-center">

        {error ? (
          <div className="text-rose-400 p-4 border border-rose-500/30 bg-rose-500/10 rounded-xl mb-4">
            {error}
          </div>
        ) : (
          <>
            <div className="mx-auto w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex flex-col items-center justify-center mb-6">
              <Download className="w-8 h-8" />
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">Tải File</h1>
            <p className="text-zinc-400 mb-8">
              Đang chờ người gửi bắt đầu truyền file. Bạn sẽ được hỏi nơi lưu file.
            </p>

            <div className="p-4 bg-black/30 border border-white/5 rounded-2xl mb-6">
              <div className="flex justify-between items-center mb-4">
                <span className="text-zinc-400 text-sm">Trạng thái</span>
                <span className={`text-sm font-medium flex items-center ${status === 'Connected' ? 'text-emerald-400' :
                  status === 'Connecting' ? 'text-yellow-400' :
                    'text-zinc-500'
                  }`}>
                  {status === 'Connecting' && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                  {status === 'Connected' ? 'Đã kết nối' : status === 'Connecting' ? 'Đang kết nối...' : 'Chưa kết nối'}
                </span>
              </div>

              {progress && (
                <div>
                  <div className="flex justify-between text-xs mb-1 text-zinc-500">
                    <span>{progress.progress >= 100 ? 'Đang xử lý & lưu file...' : isPaused ? 'Tạm dừng' : 'Đang tải...'}</span>
                    <span>{progress.progress.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>

                  <div className="flex justify-end space-x-2 mt-4">
                    <button
                      onClick={cancelTransfer}
                      className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors group/cancel"
                      title="Hủy tải file"
                    >
                      <XCircle className="w-5 h-5 group-hover/cancel:scale-110 transition-transform" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {incomingFileMetadata && !progress && (
              <div className="animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-purple-500/10 border border-purple-500/30 text-purple-300 p-4 rounded-xl mb-4 text-sm font-medium">
                  File đến: {incomingFileMetadata.name} ({Math.ceil(incomingFileMetadata.size / 1024).toLocaleString()} KB)
                </div>
                <button
                  onClick={acceptFileTransfer}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-xl font-bold transition-colors flex justify-center items-center shadow-lg shadow-blue-500/20"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Lưu file về máy
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
