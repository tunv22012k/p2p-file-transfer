'use client';

import React, { useState, useRef } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { UploadCloud, CheckCircle, XCircle, Loader2, ArrowRightCircle } from 'lucide-react';

export default function TransferContainer() {
  const { status, progress, sendFile, isReceiving } = useWebRTC();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (status !== 'Connected') {
        alert('Please wait until another peer connects!');
        return;
      }
      await sendFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (status !== 'Connected') {
        alert('Please wait until another peer connects!');
        return;
      }
      await sendFile(e.target.files[0]);
    }
  };

  // Human readable speed
  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec === 0) {
      return '0 B/s';
    }
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Convert bytes size
  const formatSize = (bytes: number) => {
    if (bytes === 0) {
      return '0 B';
    }
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full max-w-2xl mx-auto backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl overflow-hidden shadow-2xl relative">
      {/* Decorative top gradient */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

      <div className="p-8">
        {/* Header / Connection Status */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
              P2P File Transfer
            </h2>
            <p className="text-zinc-400 text-sm mt-1">Send large files securely via WebRTC</p>
          </div>

          <div className="flex items-center space-x-2 bg-black/20 px-4 py-2 rounded-full border border-white/5">
            {status === 'Connected' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
            {status === 'Connecting' && <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />}
            {status === 'Disconnected' && <XCircle className="w-4 h-4 text-rose-400" />}
            <span className={`text-sm font-medium ${status === 'Connected' ? 'text-emerald-400' :
              status === 'Connecting' ? 'text-yellow-400' :
                'text-rose-400'
              }`}>
              {status}
            </span>
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative cursor-pointer group rounded-2xl border-2 border-dashed
            flex flex-col items-center justify-center p-12 transition-all duration-300
            ${isDragging
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-white/20 bg-black/20 hover:border-purple-500/50 hover:bg-white/5'
            }
          `}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className={`p-4 rounded-full mb-4 transition-colors duration-300 ${isDragging ? 'bg-purple-500/20 text-purple-400' : 'bg-white/5 text-zinc-400 group-hover:bg-purple-500/10 group-hover:text-purple-400'
            }`}>
            <UploadCloud className="w-8 h-8" />
          </div>

          <h3 className="text-lg font-semibold text-zinc-200 mb-2">
            Click or drag & drop to send
          </h3>
          <p className="text-zinc-500 text-sm max-w-sm text-center">
            Files are transferred directly peer-to-peer. Supports files larger than 1GB.
          </p>
        </div>

        {/* Progress Display */}
        {progress && (
          <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <ArrowRightCircle className={`w-5 h-5 ${isReceiving ? 'text-emerald-400' : 'text-blue-400'}`} />
                <span className="text-zinc-200 font-medium">
                  {isReceiving ? 'Receiving' : 'Sending'}
                </span>
              </div>
              <span className="text-zinc-400 text-sm font-medium">
                {progress.progress.toFixed(1)}%
              </span>
            </div>

            <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                style={{ width: `${progress.progress}%` }}
              />
            </div>

            <div className="flex justify-between items-center mt-3 text-xs text-zinc-500 font-mono">
              <span>{formatSize(progress.bytesTransferred)} / {formatSize(progress.totalBytes)}</span>
              <span className="bg-black/30 px-2 py-1 rounded text-purple-300">
                {formatSpeed(progress.speed)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
