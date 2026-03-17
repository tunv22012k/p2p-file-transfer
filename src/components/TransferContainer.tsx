'use client';

import React, { useState, useRef } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { Upload, CheckCircle, XCircle, ArrowRightCircle, Loader2, PauseCircle, PlayCircle, FileText, FolderOpen, PackageOpen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { zipFiles, formatFileSize } from '@/lib/zipUtils';

export default function TransferContainer() {
  const { status, progress, sendFile, isReceiving, cancelTransfer, pauseTransfer, resumeTransfer, isPaused } = useWebRTC();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isZipping, setIsZipping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      const newOnes = arr.filter(f => !existing.has(f.name + f.size));
      return [...prev, ...newOnes];
    });
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => setSelectedFiles([]);

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
        toast.info('Vui lòng đợi kết nối với người nhận!');
        return;
      }
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // reset so same files can be re-added
    }
  };

  const handleSend = async () => {
    if (selectedFiles.length === 0) return;
    if (status !== 'Connected') {
      toast.info('Vui lòng đợi kết nối với người nhận!');
      return;
    }

    let fileToSend: File;

    if (selectedFiles.length === 1) {
      fileToSend = selectedFiles[0];
    } else {
      // Multiple files → zip them first
      setIsZipping(true);
      toast.info(`Đang gói ${selectedFiles.length} file...`);
      try {
        const zipName = selectedFiles[0].webkitRelativePath
          ? selectedFiles[0].webkitRelativePath.split('/')[0]  // folder name
          : 'files';
        fileToSend = await zipFiles(selectedFiles, zipName);
        toast.success(`Đã gói xong! Đang gửi ${fileToSend.name}…`);
      } catch (err) {
        console.error('Zip error:', err);
        toast.error('Không thể nén file!');
        setIsZipping(false);
        return;
      }
      setIsZipping(false);
    }

    clearFiles();
    await sendFile(fileToSend);
  };

  // Human readable speed
  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatETA = (seconds: number | null) => {
    if (seconds === null || seconds === Infinity) return 'Đang tính...';
    if (seconds < 1) return 'Xong';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0) parts.push(`${h} giờ`);
    if (m > 0) parts.push(`${m} phút`);
    if (s > 0 || parts.length === 0) parts.push(`${s} giây`);
    return `Còn khoảng ${parts.join(' ')}`;
  };

  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  return (
    <div className="w-full max-w-2xl mx-auto backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl overflow-hidden shadow-2xl relative">
      {/* Decorative top gradient */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

      <div className="p-8">
        {/* Header / Connection Status */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
              Chuyển File P2P
            </h2>
            <p className="text-zinc-400 text-sm mt-1">Truyền nhận dữ liệu an toàn qua WebRTC</p>
          </div>

          <div className="flex items-center space-x-2 bg-black/20 px-4 py-2 rounded-full border border-white/5">
            {status === 'Connected' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
            {status === 'Connecting' && <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />}
            {status === 'Disconnected' && <XCircle className="w-4 h-4 text-rose-400" />}
            <span className={`text-sm font-medium ${status === 'Connected' ? 'text-emerald-400' :
              status === 'Connecting' ? 'text-yellow-400' : 'text-rose-400'}`}>
              {status === 'Connected' ? 'Đã kết nối' :
                status === 'Connecting' ? 'Đang kết nối...' :
                  status === 'Error' ? 'Lỗi kết nối' : 'Chưa kết nối'}
            </span>
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative rounded-2xl border-2 border-dashed
            flex flex-col items-center justify-center p-8 transition-all duration-300
            ${isDragging
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-white/20 bg-black/20 hover:border-purple-500/50 hover:bg-white/5'
            }
          `}
        >
          {/* Hidden inputs */}
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple />
          <input type="file" ref={folderInputRef} onChange={handleFileSelect} className="hidden" multiple
            // @ts-expect-error webkitdirectory is not in all ts defs
            webkitdirectory="true" />

          <div className="w-14 h-14 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-3 transition-transform duration-300 hover:scale-110">
            {isDragging ? <Upload className="w-7 h-7 text-purple-400" /> : <Upload className="w-7 h-7 text-purple-400" />}
          </div>
          <p className="text-base font-semibold text-white mb-1">
            {isDragging ? 'Thả file vào đây' : 'Kéo thả file hoặc thư mục vào đây'}
          </p>
          <p className="text-zinc-400 text-sm mb-4">Hỗ trợ mọi định dạng, không giới hạn dung lượng</p>

          {!isDragging && (
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-purple-500/20 active:scale-95 flex items-center gap-2"
              >
                <FileText className="w-4 h-4" /> Chọn File
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-all active:scale-95 flex items-center gap-2"
              >
                <FolderOpen className="w-4 h-4" /> Chọn Thư mục
              </button>
            </div>
          )}
        </div>

        {/* Selected File List */}
        {selectedFiles.length > 0 && !progress && (
          <div className="mt-5 bg-black/20 border border-white/10 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-sm text-zinc-300 font-medium">
                {selectedFiles.length} file đã chọn &middot;&nbsp;
                <span className="text-zinc-500">{formatFileSize(totalSize)}</span>
              </span>
              <button onClick={clearFiles} className="text-zinc-500 hover:text-rose-400 transition-colors text-xs flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Xóa tất cả
              </button>
            </div>
            <ul className="max-h-44 overflow-y-auto divide-y divide-white/5">
              {selectedFiles.map((file, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-white/5 group">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                    <span className="truncate text-zinc-300">{file.webkitRelativePath || file.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="text-zinc-500 text-xs">{formatFileSize(file.size)}</span>
                    <button onClick={() => removeFile(i)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-rose-400 transition-all">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="px-4 py-3 border-t border-white/5">
              <button
                onClick={handleSend}
                disabled={isZipping}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-purple-500/20 active:scale-95 flex items-center justify-center gap-2"
              >
                {isZipping
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang nén file...</>
                  : selectedFiles.length === 1
                    ? <><Upload className="w-4 h-4" /> Gửi file</>
                    : <><PackageOpen className="w-4 h-4" /> Gói & Gửi ({selectedFiles.length} file)</>
                }
              </button>
            </div>
          </div>
        )}

        {/* Progress Display */}
        {progress && (
          <div className="mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <ArrowRightCircle className={`w-5 h-5 ${isReceiving ? 'text-emerald-400' : 'text-blue-400'}`} />
                <span className="text-zinc-200 font-medium whitespace-nowrap">
                  {progress.progress >= 100
                    ? (isReceiving ? 'Đang xử lý & lưu file...' : 'Đang chờ người nhận xử lý...')
                    : isPaused ? 'Tạm dừng' : isReceiving ? 'Đang nhận' : 'Đang gửi'}
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
              <div className="flex flex-col gap-1">
                <span>{formatFileSize(progress.bytesTransferred)} / {formatFileSize(progress.totalBytes)}</span>
                <span className="text-zinc-400 font-sans">{formatETA(progress.eta)}</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="bg-black/30 px-2 py-1 rounded text-purple-300">
                  {formatSpeed(progress.speed)}
                </span>
                {!isReceiving && (
                  <button
                    onClick={isPaused ? resumeTransfer : pauseTransfer}
                    className="p-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg transition-colors group/pause"
                    title={isPaused ? 'Tiếp tục' : 'Tạm dừng'}
                  >
                    {isPaused ? (
                      <PlayCircle className="w-5 h-5 group-hover/pause:scale-110 transition-transform" />
                    ) : (
                      <PauseCircle className="w-5 h-5 group-hover/pause:scale-110 transition-transform" />
                    )}
                  </button>
                )}
                <button
                  onClick={cancelTransfer}
                  className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors group/cancel"
                  title="Hủy truyền file"
                >
                  <XCircle className="w-5 h-5 group-hover/cancel:scale-110 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
