'use client';

import { useWebRTC } from '@/hooks/useWebRTC';
import { Users, FileUp, Loader2, User, ArrowLeft, Check, X, Download, FileText, FolderOpen, PackageOpen, Trash2 } from 'lucide-react';
import TransferHistory from '@/components/TransferHistory';
import IncomingRequest from '@/components/IncomingRequest';
import { PlayCircleIcon, PauseCircleIcon } from '@/components/Icons';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import { FileMetadata } from '@/types/webrtc';
import { zipFiles, formatFileSize } from '@/lib/zipUtils';

function RoomContent() {
  const {
    myId, status, progress, sendFile,
    joinRoom, leaveRoom, roomUsers, requestFileSend,
    incomingRequest, answerFileRequest,
    isReceiving, cancelTransfer, incomingFileMetadata, acceptFileTransfer,
    pauseTransfer, resumeTransfer, isPaused
  } = useWebRTC();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roomId = pathname.split('/').pop() || '';
  const username = searchParams.get('name') || '';

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatus, setRequestStatus] = useState<'idle' | 'pending' | 'accepted' | 'rejected'>('idle');

  // Get the display name of the selected user
  const getUsername = (id: string | null) => {
    if (!id) {
      return 'Unknown';
    }
    const user = roomUsers.find(u => u.id === id);
    return user?.username || id.slice(0, 8);
  };

  // Join the room on mount, cleanup on unmount (Bug 6 fix)
  useEffect(() => {
    if (roomId && status === 'Disconnected') {
      joinRoom(roomId, username || undefined);
    }
    return () => {
      leaveRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...arr.filter(f => !existing.has(f.name + f.size))];
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const formatETA = (seconds: number | null) => {
    if (seconds === null || seconds === Infinity) {
      return 'Đang tính...';
    }
    if (seconds < 1) {
      return 'Xong';
    }

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (h > 0) {
      parts.push(`${h}h`);
    }
    if (m > 0) {
      parts.push(`${m}m`);
    }
    if (s > 0 || parts.length === 0) {
      parts.push(`${s}s`);
    }

    return `Còn khoảng ${parts.join(' ')}`;
  };

  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);

  const handleSendRequest = async () => {
    if (!selectedUser || selectedFiles.length === 0) {
      return;
    }

    let fileToSend: File;

    if (selectedFiles.length === 1) {
      fileToSend = selectedFiles[0];
    } else {
      setIsZipping(true);
      try {
        const zipName = selectedFiles[0].webkitRelativePath
          ? selectedFiles[0].webkitRelativePath.split('/')[0]
          : 'files';
        fileToSend = await zipFiles(selectedFiles, zipName);
      } catch {
        setIsZipping(false);
        return;
      }
      setIsZipping(false);
    }

    setIsRequesting(true);
    setRequestStatus('pending');

    const metadata: FileMetadata = {
      name: fileToSend.name,
      size: fileToSend.size,
      type: fileToSend.type,
    };

    const accepted = await requestFileSend(selectedUser, metadata);

    setIsRequesting(false);
    if (accepted) {
      setRequestStatus('accepted');
      setSelectedFiles([]);
      await sendFile(fileToSend);
      setRequestStatus('idle');
    } else {
      setRequestStatus('rejected');
      setTimeout(() => setRequestStatus('idle'), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 pt-12 text-white">
      {/* Toast Notification for Incoming Request */}
      {incomingRequest && (
        <IncomingRequest
          request={incomingRequest}
          onAnswer={answerFileRequest}
        />
      )}

      <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-6">
        {/* Left Column: Room Info & Users */}
        <div className="w-full md:w-1/3 space-y-4">
          <Link href="/" onClick={() => leaveRoom()} className="text-zinc-400 hover:text-white flex items-center inline-flex mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Rời phòng
          </Link>

          <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
            <div className="flex items-center space-x-3 text-purple-400 mb-2">
              <Users className="w-6 h-6" />
              <h2 className="text-xl font-bold">Phòng #{roomId}</h2>
            </div>
            <p className="text-sm text-zinc-400 mb-6">
              Bạn: <span className="font-semibold text-white">{username || myId || 'Đang kết nối...'}</span>
            </p>

            <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-500 mb-3">Thành viên</h3>
            {roomUsers.length === 0 ? (
              <p className="text-sm text-zinc-500 italic">Chưa có ai khác trong phòng.</p>
            ) : (
              <ul className="space-y-2">
                {roomUsers.map(user => (
                  <li
                    key={user.id}
                    onClick={() => setSelectedUser(user.id)}
                    className={`p-3 rounded-xl cursor-pointer flex items-center justify-between transition-all border ${selectedUser === user.id
                      ? 'border-purple-500 bg-purple-500/20'
                      : 'border-transparent bg-black/20 hover:bg-white/10'
                      }`}
                  >
                    <div className="flex items-center">
                      <User className="w-4 h-4 text-zinc-400 mr-2" />
                      <span className="font-medium text-sm truncate">{user.username}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="md:h-[400px]">
            <TransferHistory />
          </div>
        </div>

        {/* Right Column: Transfer Interface */}
        <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-6 md:p-10 flex flex-col">
          {isReceiving ? (
            <div className="flex-1 flex flex-col justify-center">
              <div className="bg-black/40 border border-white/10 rounded-2xl p-6 mb-4">
                <div className="flex items-center justify-center mb-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full animate-pulse"></div>
                    <Download className="w-10 h-10 text-emerald-400 relative z-10" />
                  </div>
                </div>
                <h3 className="text-center text-lg font-semibold text-white mb-2">Đang nhận file...</h3>
                {progress ? (
                  <div className="mt-4">
                    <div className="mb-4 flex items-center justify-between">
                      <span className={`text-sm font-medium flex items-center ${isPaused ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {isPaused ? 'Tạm dừng' : <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang truyền...</>}
                      </span>
                      <span className="text-sm font-bold text-white">{progress.progress.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5 mb-4">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 ease-out"
                        style={{ width: `${progress?.progress || 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs text-zinc-400 font-mono">
                      <div className="flex flex-col gap-1">
                        <span>{(progress.bytesTransferred / 1024 / 1024).toFixed(2)} MB / {(progress.totalBytes / 1024 / 1024).toFixed(2)} MB</span>
                        <span className="text-zinc-500 font-sans">{formatETA(progress.eta)}</span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <span className="bg-black/30 px-2 py-1 rounded text-emerald-300">
                          {(progress.speed / 1024 / 1024).toFixed(2)} MB/s
                        </span>
                        <button
                          onClick={cancelTransfer}
                          className="p-1 px-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-colors border border-rose-500/20"
                        >
                          HỦY
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-emerald-400 animate-pulse mt-4">
                    <Loader2 className="w-8 h-8 animate-spin mb-2" />
                    <p className="text-sm">Đang kết nối và chờ dữ liệu...</p>
                  </div>
                )}
              </div>
            </div>
          ) : (!selectedUser && !progress) ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50">
              <FileUp className="w-16 h-16 mb-4 text-zinc-400" />
              <h3 className="text-xl font-bold mb-2">Chọn người nhận</h3>
              <p>Nhấn vào một thành viên trong phòng để gửi file.</p>
            </div>
          ) : (
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-6">
                Gửi cho <span className="text-purple-400">{getUsername(selectedUser!)}</span>
              </h2>

              {/* Transfer Progress View */}
              {progress || requestStatus === 'accepted' ? (
                <div className="mt-8">
                  <div className="mb-4 flex items-center justify-between">
                    <span className={`text-sm font-medium flex items-center ${isPaused ? 'text-yellow-400' : 'text-emerald-400'}`}>
                      {isPaused ? 'Tạm dừng' : <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang truyền...</>}
                    </span>
                    {progress && <span className="text-sm font-bold text-white">{progress.progress.toFixed(1)}%</span>}
                  </div>
                  <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5 mb-2">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                      style={{ width: `${progress?.progress || 0}%` }}
                    />
                  </div>
                  {progress && (
                    <div className="flex justify-between items-center text-xs text-zinc-500 font-mono">
                      <div className="flex flex-col gap-1">
                        <span>{(progress.bytesTransferred / 1024 / 1024).toFixed(2)} MB / {(progress.totalBytes / 1024 / 1024).toFixed(2)} MB</span>
                        <span className="text-zinc-600 font-sans">{formatETA(progress.eta)}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="bg-black/30 px-2 py-1 rounded text-purple-300">
                          {(progress.speed / 1024 / 1024).toFixed(2)} MB/s
                        </span>
                        <button
                          onClick={isPaused ? resumeTransfer : pauseTransfer}
                          className="p-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg transition-colors group/pause"
                          title={isPaused ? "Tiếp tục" : "Tạm dừng"}
                        >
                          {isPaused ? <PlayCircleIcon className="w-4 h-4 group-hover/pause:scale-110 transition-transform" /> : <PauseCircleIcon className="w-4 h-4 group-hover/pause:scale-110 transition-transform" />}
                        </button>
                        <button
                          onClick={cancelTransfer}
                          className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors"
                          title="Hủy truyền file"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Pre-Transfer View */
                <div className="space-y-4">
                  {/* Hidden file inputs */}
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple />
                  <input type="file" ref={folderInputRef} onChange={handleFileSelect} className="hidden" multiple
                    // @ts-expect-error webkitdirectory is not a standard attr in all TS defs
                    webkitdirectory="true" />

                  {/* Drag and drop area */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`
                      w-full flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl transition-all
                      ${isDragging ? 'border-purple-500 bg-purple-500/10' : 'border-white/20 hover:border-purple-500/50 hover:bg-white/5'}
                    `}
                  >
                    <div className="w-14 h-14 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-3">
                      <FileUp className="w-7 h-7 text-purple-400" />
                    </div>
                    <p className="text-sm font-semibold text-white mb-1">
                      {isDragging ? 'Thả file vào đây' : 'Nhấn hoặc kéo thả file'}
                    </p>
                    <p className="text-zinc-500 text-xs mb-4">Kéo file vào đây để gửi cho thành viên trong phòng</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 active:scale-95"
                      >
                        <FileText className="w-3.5 h-3.5" /> Chọn File
                      </button>
                      <button
                        onClick={() => folderInputRef.current?.click()}
                        className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 active:scale-95"
                      >
                        <FolderOpen className="w-3.5 h-3.5" /> Chọn Thư mục
                      </button>
                    </div>
                  </div>

                  {/* Selected file list */}
                  {selectedFiles.length > 0 && (
                    <div className="bg-black/20 border border-white/10 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                        <span className="text-xs text-zinc-400">
                          {selectedFiles.length} file &middot; {formatFileSize(totalSize)}
                        </span>
                        <button onClick={() => setSelectedFiles([])} className="text-zinc-500 hover:text-rose-400 text-xs flex items-center gap-1 transition-colors">
                          <Trash2 className="w-3 h-3" /> Xóa tất cả
                        </button>
                      </div>
                      <ul className="max-h-36 overflow-y-auto divide-y divide-white/5">
                        {selectedFiles.map((file, i) => (
                          <li key={i} className="flex items-center justify-between px-4 py-2 text-xs hover:bg-white/5 group">
                            <span className="truncate text-zinc-300 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              {file.webkitRelativePath || file.name}
                            </span>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-zinc-500">{formatFileSize(file.size)}</span>
                              <button onClick={() => setSelectedFiles(prev => prev.filter((_, j) => j !== i))}
                                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-rose-400 transition-all">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {requestStatus === 'rejected' && (
                    <div className="text-rose-400 text-sm text-center bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                      {getUsername(selectedUser!)} đã từ chối nhận file.
                    </div>
                  )}

                  <button
                    onClick={handleSendRequest}
                    disabled={selectedFiles.length === 0 || isRequesting || isZipping}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-bold transition-colors shadow-lg shadow-purple-900/20 flex justify-center items-center"
                  >
                    {isZipping ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Đang nén file...</>
                    ) : isRequesting ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Đang chờ {getUsername(selectedUser!)} chấp nhận...</>
                    ) : selectedFiles.length > 1 ? (
                      <><PackageOpen className="w-5 h-5 mr-2" /> Gói & Gửi ({selectedFiles.length} file)</>
                    ) : (
                      'Yêu cầu gửi file'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
      <RoomContent />
    </Suspense>
  );
}
