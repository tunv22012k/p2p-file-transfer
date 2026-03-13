'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Link2, Users } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');

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

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center py-20 px-4 sm:px-6 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[400px] opacity-30 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/30 via-purple-500/30 to-pink-500/30 blur-[100px] rounded-full mix-blend-screen" />
      </div>

      <div className="text-center mb-16 relative z-10">
        <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl mb-4">
          Truyền File Siêu Tốc <br/>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
            Ngang Hàng (P2P)
          </span>
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
          Chia sẻ file an toàn với mã hóa đầu cuối (E2E).
          Chọn phương thức chia sẻ bên dưới để bắt đầu.
        </p>
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
    </main>
  );
}
