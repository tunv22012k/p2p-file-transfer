'use client';

import React, { useEffect, useState } from 'react';
import { historyUtil } from '@/lib/history';
import { TransferHistoryItem } from '@/types/webrtc';
import { Clock, File, Download, Upload, CheckCircle2, XCircle, Trash2 } from 'lucide-react';

export default function TransferHistory() {
  const [history, setHistory] = useState<TransferHistoryItem[]>([]);

  const loadHistory = () => {
    setHistory(historyUtil.getHistory());
  };

  useEffect(() => {
    loadHistory();
    window.addEventListener('transfer-history-updated', loadHistory);
    return () => window.removeEventListener('transfer-history-updated', loadHistory);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  };

  if (history.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
        <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-3 opacity-20" />
        <p className="text-zinc-500 text-sm">Chưa có lịch sử truyền file.</p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-6 overflow-hidden flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-500 flex items-center">
          <Clock className="w-4 h-4 mr-2" /> Lịch sử
        </h3>
        <button
          onClick={() => historyUtil.clearHistory()}
          className="text-zinc-500 hover:text-rose-400 p-1 transition-colors"
          title="Xóa lịch sử"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar">
        {history.map((item) => (
          <div
            key={item.id}
            className="p-3 bg-black/20 rounded-xl border border-white/5 flex items-center justify-between group hover:border-white/10 transition-colors"
          >
            <div className="flex items-center min-w-0">
              <div className={`p-2 rounded-lg mr-3 ${item.type === 'sent' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {item.type === 'sent' ? <Upload className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate pr-2" title={item.fileName}>
                  {item.fileName}
                </p>
                <p className="text-[10px] text-zinc-500 flex items-center mt-0.5">
                  <span className="mr-2">{formatSize(item.fileSize)}</span>
                  <span>{formatDate(item.timestamp)}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center ml-2">
              {item.status === 'completed' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-500" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
