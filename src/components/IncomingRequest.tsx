'use client';

import { Check, X, Download } from 'lucide-react';
import { FileMetadata } from '@/types/webrtc';

interface IncomingRequestProps {
  request: {
    from: string;
    fromUsername: string;
    metadata: FileMetadata;
  };
  onAnswer: (accept: boolean) => void;
}

export default function IncomingRequest({ request, onAnswer }: IncomingRequestProps) {
  return (
    <div className="fixed top-4 right-4 z-50 bg-white/10 backdrop-blur-2xl border border-white/20 p-6 rounded-3xl shadow-2xl max-w-sm w-full animate-in slide-in-from-top-4 border-emerald-500/30">
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center text-emerald-400">
          <Download className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">File đang đến</h3>
          <p className="text-[10px] text-emerald-400 uppercase font-bold tracking-wider">Yêu cầu nhận file</p>
        </div>
      </div>

      <p className="text-sm text-zinc-300 mb-3">
        <span className="font-semibold text-white">{request.fromUsername}</span> muốn gửi cho bạn:
      </p>

      <div className="bg-black/40 p-4 rounded-2xl mb-6 border border-white/5">
        <p className="text-sm font-medium text-white truncate">{request.metadata.name}</p>
        <p className="text-xs text-zinc-500 mt-1">{formatSize(request.metadata.size)}</p>
      </div>

      <div className="flex space-x-3">
        <button
          onClick={() => onAnswer(true)}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl flex items-center justify-center font-bold transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
        >
          <Check className="w-5 h-5 mr-2" /> Nhận
        </button>
        <button
          onClick={() => onAnswer(false)}
          className="flex-1 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl flex items-center justify-center font-bold transition-all active:scale-95"
        >
          <X className="w-5 h-5 mr-2" /> Từ chối
        </button>
      </div>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
