'use client';

import { useWebRTC } from '@/hooks/useWebRTC';
import { generateKeyString, importKeyString } from '@/lib/crypto';
import { Copy, FileUp, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export default function ShareSenderPage() {
  const { myId, status, progress, sendFile, setCryptoKey } = useWebRTC();
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [fileToShare, setFileToShare] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyStrRef = useRef<string>('');

  // Generate the encryption key once, then update link whenever myId changes (socket reconnect)
  useEffect(() => {
    if (!myId) {
      return;
    }

    const updateLink = async () => {
      if (!keyStrRef.current) {
        // First time: generate a new key
        keyStrRef.current = await generateKeyString();
        const key = await importKeyString(keyStrRef.current);
        setCryptoKey(key);
      }
      const link = `${window.location.origin}/share/${myId}#${keyStrRef.current}`;
      setShareLink(link);
    };

    updateLink();
  }, [myId, setCryptoKey]);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFileToShare(e.target.files[0]);
    }
  };

  const hasSentRef = useRef(false);

  // Automatically send the file when the receiver connects
  useEffect(() => {
    if (status === 'Connected' && fileToShare && !progress && !hasSentRef.current) {
      hasSentRef.current = true;
      sendFile(fileToShare);
    }
  }, [status, fileToShare, progress, sendFile]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center py-20 px-4">
      <div className="w-full max-w-2xl text-left mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white flex items-center inline-flex">
          <ArrowLeft className="w-4 h-4 mr-2" /> Quay lại
        </Link>
      </div>

      <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 mb-2">
          Chia sẻ File
        </h1>

        {/* Step 1: File Selection */}
        <div className="mb-8">
          <label className="block text-sm font-medium text-zinc-300 mb-2">1. Chọn file</label>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          {fileToShare ? (
            <div className="flex items-center justify-between p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl">
              <span className="text-purple-300 font-medium truncate pr-4">{fileToShare.name}</span>
              <button
                onClick={() => setFileToShare(null)}
                className="text-zinc-400 hover:text-white text-sm"
              >
                Đổi
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center p-6 border-2 border-dashed border-white/20 hover:border-blue-500/50 hover:bg-white/5 rounded-xl transition-all"
            >
              <FileUp className="w-6 h-6 mr-3 text-zinc-400" />
              <span className="text-zinc-300">Chọn file từ thiết bị của bạn</span>
            </button>
          )}
        </div>

        {/* Step 2: Share Link */}
        <div className={`mb-8 transition-opacity duration-300 ${fileToShare ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          <label className="block text-sm font-medium text-zinc-300 mb-2">2. Đường dẫn chia sẻ</label>
          {!fileToShare ? (
            <div className="bg-black/30 border border-white/5 rounded-xl px-4 py-4 text-zinc-500 text-sm text-center">
              Vui lòng chọn file trước để tạo đường dẫn chia sẻ.
            </div>
          ) : shareLink ? (
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 font-mono text-sm"
              />
              <button
                onClick={handleCopy}
                className="bg-zinc-800 hover:bg-zinc-700 text-white p-3 rounded-xl transition-colors min-w-[48px] flex justify-center"
              >
                {copied ? <span className="text-emerald-400 text-sm font-medium">Đã sao chép!</span> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Đang tạo đường dẫn bảo mật...</span>
            </div>
          )}
        </div>

        {/* Step 3: Status & Action */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">3. Trạng thái truyền file</label>

          <div className="flex items-center justify-between p-4 bg-black/30 rounded-xl mb-4">
            <span className="text-zinc-400">Kết nối</span>
            <span className={`font-medium ${status === 'Connected' ? 'text-emerald-400' :
              status === 'Connecting' ? 'text-yellow-400' :
                'text-rose-400'
              }`}>
              {status === 'Connected' ? 'Người nhận đã kết nối' : 'Đang chờ người nhận...'}
            </span>
          </div>

          {progress && (
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-1 text-zinc-400">
                <span>{progress.progress >= 100 ? 'Đang chờ người nhận xử lý...' : 'Đang gửi...'}</span>
                <span>{progress.progress.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            </div>
          )}

          {status === 'Connected' && !progress && (
            <div className="w-full bg-blue-600/20 text-blue-400 border border-blue-500/30 px-6 py-4 rounded-xl font-medium text-center animate-pulse">
              Đang bắt đầu truyền file...
            </div>
          )}

          {progress && (
            <div className="w-full bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 px-6 py-4 rounded-xl font-medium text-center">
              {progress.progress >= 100 ? 'Người nhận đang lưu file, chuẩn bị hoàn tất...' : 'Đang truyền file... Vui lòng không đóng trang này.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
