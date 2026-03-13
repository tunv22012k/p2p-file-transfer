'use client';

import { useWebRTC } from '@/hooks/useWebRTC';
import { Users, FileUp, Loader2, User, ArrowLeft, Check, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import { FileMetadata } from '@/types/webrtc';

function RoomContent() {
  const {
    myId, status, progress, sendFile,
    joinRoom, leaveRoom, roomUsers, requestFileSend,
    incomingRequest, answerFileRequest,
    isReceiving
  } = useWebRTC();

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roomId = pathname.split('/').pop() || '';
  const username = searchParams.get('name') || '';

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [fileToShare, setFileToShare] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatus, setRequestStatus] = useState<'idle' | 'pending' | 'accepted' | 'rejected'>('idle');

  // Get the display name of the selected user
  const getUsername = (id: string) => {
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFileToShare(e.target.files[0]);
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
      setFileToShare(e.dataTransfer.files[0]);
    }
  };

  const handleSendRequest = async () => {
    if (!selectedUser || !fileToShare) {
      return;
    }

    setIsRequesting(true);
    setRequestStatus('pending');

    const metadata: FileMetadata = {
      name: fileToShare.name,
      size: fileToShare.size,
      type: fileToShare.type,
    };

    const accepted = await requestFileSend(selectedUser, metadata);

    setIsRequesting(false);
    if (accepted) {
      setRequestStatus('accepted');
      await sendFile(fileToShare);
      setRequestStatus('idle');
      setFileToShare(null);
    } else {
      setRequestStatus('rejected');
      setTimeout(() => setRequestStatus('idle'), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 pt-12 text-white">
      {/* Toast Notification for Incoming Request */}
      {incomingRequest && (
        <div className="fixed top-4 right-4 z-50 bg-white/10 backdrop-blur-xl border border-white/20 p-6 rounded-2xl shadow-2xl max-w-sm w-full animate-in slide-in-from-top-4">
          <h3 className="text-lg font-bold mb-2">📥 File đến</h3>
          <p className="text-sm text-zinc-300 mb-1">
            <span className="font-semibold text-purple-400">{incomingRequest.fromUsername}</span> muốn gửi cho bạn:
          </p>
          <div className="bg-black/30 p-3 rounded-xl mb-4 text-sm font-medium">
            {incomingRequest.metadata.name} ({Math.ceil(incomingRequest.metadata.size / 1024).toLocaleString()} KB)
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => answerFileRequest(true)}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2 rounded-xl flex justify-center transition-colors"
            >
              <Check className="w-5 h-5 mr-1" /> Chấp nhận
            </button>
            <button
              onClick={() => answerFileRequest(false)}
              className="flex-1 bg-rose-600 hover:bg-rose-500 py-2 rounded-xl flex justify-center transition-colors"
            >
              <X className="w-5 h-5 mr-1" /> Từ chối
            </button>
          </div>
        </div>
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
        </div>

        {/* Right Column: Transfer Interface */}
        <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-6 md:p-10 flex flex-col">
          {isReceiving ? (
            <div className="flex-1 flex flex-col justify-center">
              <h2 className="text-2xl font-bold mb-6 text-center text-emerald-400">
                📥 Đang nhận file...
              </h2>
              {progress ? (
                <div className="mt-8 bg-black/20 p-8 rounded-2xl border border-white/5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-emerald-400 flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang truyền...
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
                    <span>{(progress.bytesTransferred / 1024 / 1024).toFixed(2)} MB / {(progress.totalBytes / 1024 / 1024).toFixed(2)} MB</span>
                    <span className="bg-black/30 px-2 py-1 rounded text-emerald-300">
                      {(progress.speed / 1024 / 1024).toFixed(2)} MB/s
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-emerald-400 animate-pulse mt-12">
                  <Loader2 className="w-10 h-10 animate-spin mb-4" />
                  <p>Đang kết nối và chờ dữ liệu...</p>
                </div>
              )}
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
                    <span className="text-sm font-medium text-emerald-400 flex items-center">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang truyền...
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
                      <span>{(progress.bytesTransferred / 1024 / 1024).toFixed(2)} MB / {(progress.totalBytes / 1024 / 1024).toFixed(2)} MB</span>
                      <span className="bg-black/30 px-2 py-1 rounded text-purple-300">
                        {(progress.speed / 1024 / 1024).toFixed(2)} MB/s
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                /* Pre-Transfer View */
                <div className="space-y-6">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {fileToShare ? (
                    <div className="flex items-center justify-between p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                      <span className="text-purple-300 font-medium truncate pr-4">{fileToShare.name}</span>
                      <button onClick={() => setFileToShare(null)} className="text-zinc-400 hover:text-white text-sm">Đổi</button>
                    </div>
                  ) : (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`
                        w-full flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl transition-all cursor-pointer
                        ${isDragging 
                          ? 'border-purple-500 bg-purple-500/10' 
                          : 'border-white/20 hover:border-purple-500/50 hover:bg-white/5'
                        }
                      `}
                    >
                      <FileUp className={`w-10 h-10 mb-2 transition-colors ${isDragging ? 'text-purple-400' : 'text-zinc-400'}`} />
                      <span className={`text-lg font-medium transition-colors ${isDragging ? 'text-purple-400' : 'text-zinc-300'}`}>
                        {isDragging ? 'Thả file vào đây' : 'Nhấn hoặc kéo file vào đây'}
                      </span>
                      <p className="text-zinc-500 text-sm mt-2">Hỗ trợ mọi định dạng file</p>
                    </div>
                  )}

                  {requestStatus === 'rejected' && (
                    <div className="text-rose-400 text-sm text-center bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                      {getUsername(selectedUser!)} đã từ chối nhận file.
                    </div>
                  )}

                  <button
                    onClick={handleSendRequest}
                    disabled={!fileToShare || isRequesting}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-bold transition-colors shadow-lg shadow-purple-900/20 flex justify-center items-center"
                  >
                    {isRequesting ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Đang chờ {getUsername(selectedUser!)} chấp nhận...</>
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
