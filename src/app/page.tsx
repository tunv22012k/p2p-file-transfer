'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { Link2, Users, Monitor, ShieldCheck, Zap, Globe, X, FileUp, Loader2, PackageOpen, FileText, FolderOpen, Trash2, Download } from 'lucide-react';
import { useWebRTC } from '@/hooks/useWebRTC';
import TransferHistory from '@/components/TransferHistory';
import IncomingRequest from '@/components/IncomingRequest';
import { FileMetadata } from '@/types/webrtc';
import { zipFiles, formatFileSize } from '@/lib/zipUtils';
import { PlayCircleIcon, PauseCircleIcon } from '@/components/Icons';

export default function Home() {
  const router = useRouter();
  const {
    nearbyUsers, status, progress, sendFile,
    requestFileSend, incomingRequest, answerFileRequest,
    isReceiving, cancelTransfer, isPaused, pauseTransfer, resumeTransfer,
    updateNearbyName
  } = useWebRTC();

  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [deviceName, setDeviceName] = useState('');

  // Load device name from localStorage and notify server
  useEffect(() => {
    const savedName = localStorage.getItem('p2p-device-name') || '';
    if (savedName) {
      setDeviceName(savedName);
      // Wait for socket to be ready
      const timer = setTimeout(() => updateNearbyName(savedName), 1000);
      return () => clearTimeout(timer);
    }
  }, [updateNearbyName]);

  const handleDeviceNameChange = (name: string) => {
    setDeviceName(name);
    localStorage.setItem('p2p-device-name', name);
    updateNearbyName(name);
  };

  // Nearby Transfer State
  const [selectedNearbyPeer, setSelectedNearbyPeer] = useState<{ id: string, username: string } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isZipping, setIsZipping] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatus, setRequestStatus] = useState<'idle' | 'pending' | 'accepted' | 'rejected'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      const name = username.trim() || `Khách-${Math.random().toString(36).slice(2, 6)}`;
      router.push(`/room/${roomId.trim()}?name=${encodeURIComponent(name)}`);
    }
  };

  const handleCreateLink = () => {
    router.push('/share/new');
  };

  const handleConnectPeer = (user: { id: string, username: string }) => {
    setSelectedNearbyPeer(user);
    setSelectedFiles([]);
    setRequestStatus('idle');
  };

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

  const handleSendRequest = async () => {
    if (!selectedNearbyPeer || selectedFiles.length === 0) return;

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

    const accepted = await requestFileSend(selectedNearbyPeer.id, metadata);

    setIsRequesting(false);
    if (accepted) {
      setRequestStatus('accepted');
      setSelectedFiles([]);
      // Connection and sender setup is handled inside requestFileSend in useWebRTC
      await sendFile(fileToSend);
      setSelectedNearbyPeer(null);
      setRequestStatus('idle');
    } else {
      setRequestStatus('rejected');
      setTimeout(() => setRequestStatus('idle'), 3000);
    }
  };

  const formatETA = (seconds: number | null) => {
    if (seconds === null || seconds === Infinity) return 'Đang tính...';
    if (seconds < 1) return 'Xong';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return `Còn khoảng ${parts.join(' ')}`;
  };

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center py-20 px-4 sm:px-6 relative overflow-hidden">
      {/* Incoming Request Notification */}
      {incomingRequest && (
        <IncomingRequest
          request={incomingRequest}
          onAnswer={answerFileRequest}
        />
      )}

      {/* Nearby Transfer Overlay */}
      {selectedNearbyPeer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => !isRequesting && !progress && setSelectedNearbyPeer(null)} />
          <div className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setSelectedNearbyPeer(null)}
              disabled={isRequesting || !!progress}
              className="absolute top-6 right-6 p-2 text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <h2 className="text-2xl font-bold text-white mb-2">Gửi cho {selectedNearbyPeer.username}</h2>
            <p className="text-zinc-500 text-sm mb-8 italic">Thiết bị trong mạng LAN của bạn</p>

            {progress ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-medium flex items-center">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isPaused ? 'Tạm dừng' : 'Đang gửi...'}
                  </span>
                  <span className="text-white font-bold">{progress.progress.toFixed(1)}%</span>
                </div>
                <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-zinc-500 font-mono">
                  <span>{formatFileSize(progress.bytesTransferred)} / {formatFileSize(progress.totalBytes)}</span>
                  <span>{formatETA(progress.eta)}</span>
                </div>
                <div className="flex justify-center space-x-4">
                  <button onClick={isPaused ? resumeTransfer : pauseTransfer} className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl text-white transition-colors">
                    {isPaused ? <PlayCircleIcon className="w-6 h-6" /> : <PauseCircleIcon className="w-6 h-6" />}
                  </button>
                  <button onClick={cancelTransfer} className="p-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-2xl transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* File picker */}
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" multiple />
                <input type="file" ref={folderInputRef} onChange={handleFileSelect} className="hidden" multiple
                  // @ts-expect-error webkitdirectory is not in all ts defs
                  webkitdirectory="true" />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-40 border-2 border-dashed border-white/10 hover:border-emerald-500/50 hover:bg-emerald-500/5 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all"
                >
                  <FileUp className="w-10 h-10 text-zinc-600 mb-3" />
                  <p className="text-sm text-zinc-400">Nhấn để chọn file hoặc thư mục</p>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="bg-black/20 border border-white/5 rounded-2xl overflow-hidden max-h-40 overflow-y-auto">
                    <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/5">
                      <span className="text-xs text-zinc-400">{selectedFiles.length} file &middot; {formatFileSize(selectedFiles.reduce((s, f) => s + f.size, 0))}</span>
                      <button onClick={() => setSelectedFiles([])} className="text-zinc-500 hover:text-rose-400 text-xs flex items-center gap-1 transition-colors"><Trash2 className="w-3 h-3" /> Xóa</button>
                    </div>
                    {selectedFiles.map((file, i) => (
                      <div key={i} className="p-3 flex items-center justify-between text-xs border-b border-white/5 last:border-0">
                        <span className="truncate text-zinc-300 flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-zinc-500" /> {file.name}
                        </span>
                        <span className="text-zinc-500 shrink-0">{formatFileSize(file.size)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {requestStatus === 'rejected' && (
                  <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm text-center rounded-xl">
                    Đối tác đã từ chối nhận file.
                  </div>
                )}

                <button
                  onClick={handleSendRequest}
                  disabled={selectedFiles.length === 0 || isRequesting || isZipping}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-4 rounded-2xl font-bold flex items-center justify-center transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
                >
                  {isZipping ? <><Loader2 className="w-5 h-5 mr-3 animate-spin" /> Đang nén...</> :
                    isRequesting ? <><Loader2 className="w-5 h-5 mr-3 animate-spin" /> Đang chờ chấp nhận...</> :
                      selectedFiles.length > 1 ? <><PackageOpen className="w-5 h-5 mr-3" /> Gửi gói ({selectedFiles.length} file)</> :
                        'Gửi file'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Receiver Overlay */}
      {isReceiving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm"></div>

          <div className="relative w-full max-w-md bg-zinc-900 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center justify-center mb-6">
              <div className="relative mb-4">
                <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full animate-pulse"></div>
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center relative z-10 border border-emerald-500/20">
                  <Download className="w-8 h-8 text-emerald-400" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-white text-center">Đang nhận file...</h3>
              <p className="text-sm text-zinc-400 mt-1">Vui lòng không đóng trang này</p>
            </div>

            {progress ? (
              <div className="w-full">
                <div className="mb-3 flex items-center justify-between">
                  <span className={`text-sm font-medium flex items-center ${isPaused ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {isPaused ? 'Tạm dừng' : <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang truyền...</>}
                  </span>
                  <span className="text-sm font-bold text-white">{progress.progress.toFixed(1)}%</span>
                </div>

                <div className="w-full h-3 bg-black/50 rounded-full overflow-hidden border border-white/5 mb-4">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 ease-out"
                    style={{ width: `${progress?.progress || 0}%` }}
                  />
                </div>

                <div className="flex justify-between items-end">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-mono text-zinc-300">
                      {(progress.bytesTransferred / 1024 / 1024).toFixed(2)} MB / {(progress.totalBytes / 1024 / 1024).toFixed(2)} MB
                    </span>
                    <span className="text-xs text-zinc-500">{formatETA(progress.eta)}</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="bg-black/30 px-2 py-1 rounded text-emerald-300 text-xs font-mono border border-emerald-500/10">
                      {(progress.speed / 1024 / 1024).toFixed(2)} MB/s
                    </span>
                    <button
                      onClick={cancelTransfer}
                      className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors border border-rose-500/20"
                      title="Hủy"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-emerald-400 animate-pulse py-8">
                <Loader2 className="w-8 h-8 animate-spin mb-3 text-emerald-500" />
                <p className="text-sm font-medium">Đang thiết lập kết nối dữ liệu...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Background decorations */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[400px] opacity-30 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/30 via-purple-500/30 to-pink-500/30 blur-[100px] rounded-full mix-blend-screen" />
      </div>
      <div className="text-center mb-16 relative z-10">
        <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl mb-4">
          Truyền File Siêu Tốc <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
            P2P
          </span>
        </h1>
      </div>

      <div className="w-full max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
        {/* Link Share Option */}
        <div
          onClick={handleCreateLink}
          className="backdrop-blur-xl bg-white/5 border border-white/10 hover:border-blue-500/50 hover:bg-white/10 rounded-3xl p-8 cursor-pointer transition-all flex flex-col items-center text-center group"
        >
          <div className="p-4 bg-blue-500/10 text-blue-400 rounded-full mb-6 group-hover:scale-110 transition-transform">
            <Link2 className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Chia sẻ qua Link</h2>
          <p className="text-zinc-400">
            Tạo một đường dẫn bảo mật. Người nhận mở link để tải file trực tiếp từ trình duyệt của bạn.
          </p>
        </div>

        {/* Room Share Option */}
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col items-center text-center">
          <div className="p-4 bg-purple-500/10 text-purple-400 rounded-full mb-6">
            <Users className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Vào Phòng</h2>
          <p className="text-zinc-400 mb-6">
            Nhập mã phòng để tham gia. Mọi người trong phòng đều có thể gửi và nhận file với nhau.
          </p>

          <form onSubmit={handleJoinRoom} className="w-full space-y-3">
            <input
              type="text"
              placeholder="Tên hiển thị (VD: Minh, Hùng...)"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 placeholder:text-zinc-600"
            />
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Nhập mã phòng"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 placeholder:text-zinc-600"
              />
              <button
                type="submit"
                disabled={!roomId.trim()}
                className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium transition-colors"
              >
                Vào
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="w-full max-w-4xl mx-auto mt-12 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <div className="flex items-center space-x-3 text-emerald-400">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Globe className="w-5 h-5 animate-pulse" />
            </div>
            <h2 className="text-xl font-bold text-white">Thiết bị quanh đây</h2>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-[10px] font-bold rounded uppercase tracking-wider">
              LAN
            </span>
          </div>

          <div className="flex items-center space-x-3 bg-white/5 border border-white/10 rounded-2xl p-2 px-4 backdrop-blur-md">
            <div className="hidden sm:block">
              <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider text-right">Tên của bạn</p>
              <p className="text-white text-xs font-medium text-right">{deviceName || 'Chưa đặt tên'}</p>
            </div>
            <input
              type="text"
              placeholder="Sửa tên (VD: Mac của Tú)"
              value={deviceName}
              onChange={(e) => handleDeviceNameChange(e.target.value)}
              className="w-32 sm:w-40 bg-black/40 border border-white/5 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-zinc-700"
            />
          </div>
        </div>

        {nearbyUsers.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {nearbyUsers.map(user => (
              <div
                key={user.id}
                onClick={() => handleConnectPeer(user)}
                className="group relative backdrop-blur-md bg-white/5 border border-white/10 p-4 rounded-2xl cursor-pointer hover:bg-white/10 hover:border-emerald-500/40 transition-all text-center"
              >
                <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                  <Monitor className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-white font-medium text-sm truncate">{user.username}</p>
                <p className="text-zinc-500 text-[10px] uppercase mt-1">Sẵn sàng</p>
                <div className="absolute top-2 right-2 w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full flex flex-col items-center justify-center p-10 border border-dashed border-white/10 rounded-3xl bg-white/5 backdrop-blur-sm">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
            <p className="text-zinc-400 font-medium">Đang tìm kiếm thiết bị lân cận...</p>
          </div>
        )}
      </div>

      {/* Feature section for premium feel */}
      <div className="w-full max-w-4xl mx-auto mt-5 grid grid-cols-1 sm:grid-cols-3 gap-8 relative z-10 border-t border-white/5 pt-5 pb-1">
        {/* <div className="flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-blue-500/10 text-blue-400 rounded-xl flex items-center justify-center mb-4">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-white font-semibold mb-2">Bảo mật E2E</h3>
          <p className="text-zinc-500 text-xs">Mã hóa AES-GCM 256-bit trực tiếp trên trình duyệt.</p>
        </div>
        <div className="flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-yellow-500/10 text-yellow-400 rounded-xl flex items-center justify-center mb-4">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-white font-semibold mb-2">Tốc độ tối đa</h3>
          <p className="text-zinc-500 text-xs">Truyền qua LAN/P2P không giới hạn tốc độ server.</p>
        </div>
        <div className="flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-purple-500/10 text-purple-400 rounded-xl flex items-center justify-center mb-4">
            <Monitor className="w-5 h-5" />
          </div>
          <h3 className="text-white font-semibold mb-2">Không cần cài đặt</h3>
          <p className="text-zinc-500 text-xs">Hoạt động ngay trên mọi trình duyệt hiện đại.</p>
        </div> */}
      </div>

      {/* Floating history button/section if needed, or just bottom section */}
      <div className="w-full max-w-4xl mx-auto relative z-10 mb-20 opacity-80 hover:opacity-100 transition-opacity">
        <TransferHistory />
      </div>
    </main>
  );
}
