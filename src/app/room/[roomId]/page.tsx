'use client';

import { useWebRTC } from '@/hooks/useWebRTC';
import { Users, FileUp, Loader2, User, ArrowLeft, Check, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FileMetadata } from '@/types/webrtc';

export default function RoomPage() {
  const { 
    myId, status, progress, sendFile, 
    joinRoom, roomUsers, requestFileSend,
    incomingRequest, answerFileRequest,
    isReceiving
  } = useWebRTC();
  
  const pathname = usePathname();
  const roomId = pathname.split('/').pop() || '';
  
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [fileToShare, setFileToShare] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isRequesting, setIsRequesting] = useState(false);
  const [requestStatus, setRequestStatus] = useState<'idle'|'pending'|'accepted'|'rejected'>('idle');

  // Join the room on mount
  useEffect(() => {
    if (roomId && status === 'Disconnected') {
      joinRoom(roomId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFileToShare(e.target.files[0]);
    }
  };

  const handleSendRequest = async () => {
    if (!selectedUser || !fileToShare) return;
    
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
      // They accepted, start WebRTC encryption & transfer
      await sendFile(fileToShare);
      setRequestStatus('idle');
      setFileToShare(null); // Clear selected file for next transfer
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
            <h3 className="text-lg font-bold mb-2">Incoming File</h3>
            <p className="text-sm text-zinc-300 mb-1">
              Peer <span className="font-mono text-purple-400">{incomingRequest.from}</span> wants to send you:
            </p>
            <div className="bg-black/30 p-3 rounded-xl mb-4 text-sm font-medium">
               {incomingRequest.metadata.name} ({Math.ceil(incomingRequest.metadata.size / 1024).toLocaleString()} KB)
            </div>
            <div className="flex space-x-2">
               <button 
                 onClick={() => answerFileRequest(true)}
                 className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2 rounded-xl flex justify-center transition-colors"
               >
                 <Check className="w-5 h-5 mr-1" /> Accept
               </button>
               <button 
                 onClick={() => answerFileRequest(false)}
                 className="flex-1 bg-rose-600 hover:bg-rose-500 py-2 rounded-xl flex justify-center transition-colors"
               >
                 <X className="w-5 h-5 mr-1" /> Decline
               </button>
            </div>
         </div>
      )}

      <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-6">
        {/* Left Column: Room Info & Users */}
        <div className="w-full md:w-1/3 space-y-4">
           <Link href="/" className="text-zinc-400 hover:text-white flex items-center inline-flex mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" /> Leave Room
           </Link>
           
           <div className="bg-white/5 border border-white/10 rounded-3xl p-6">
              <div className="flex items-center space-x-3 text-purple-400 mb-2">
                 <Users className="w-6 h-6" />
                 <h2 className="text-xl font-bold">Room #{roomId}</h2>
              </div>
              <p className="text-sm text-zinc-400 mb-6">
                 Your ID: <span className="font-mono text-white">{myId || 'Connecting...'}</span>
              </p>

              <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-500 mb-3">Participants</h3>
              {roomUsers.length === 0 ? (
                 <p className="text-sm text-zinc-500 italic">No one else is here.</p>
              ) : (
                 <ul className="space-y-2">
                    {roomUsers.map(user => (
                       <li 
                         key={user}
                         onClick={() => setSelectedUser(user)}
                         className={`p-3 rounded-xl cursor-pointer flex items-center justify-between transition-all border ${
                            selectedUser === user 
                              ? 'border-purple-500 bg-purple-500/20' 
                              : 'border-transparent bg-black/20 hover:bg-white/10'
                         }`}
                       >
                          <div className="flex items-center">
                            <User className="w-4 h-4 text-zinc-400 mr-2" />
                            <span className="font-mono text-sm truncate">{user}</span>
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
                   Receiving File...
                </h2>
                {progress ? (
                   <div className="mt-8 bg-black/20 p-8 rounded-2xl border border-white/5">
                      <div className="mb-4 flex items-center justify-between">
                         <span className="text-sm font-medium text-emerald-400 flex items-center">
                           <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Transferring...
                         </span>
                      </div>
                      <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5 mb-4">
                         <div 
                           className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 ease-out"
                           style={{ width: `${progress?.progress || 0}%` }}
                         />
                      </div>
                      <div className="flex justify-between items-center text-xs text-zinc-400 font-mono">
                         <span>{(progress.bytesTransferred/1024/1024).toFixed(2)} MB / {(progress.totalBytes/1024/1024).toFixed(2)} MB</span>
                         <span className="bg-black/30 px-2 py-1 rounded text-emerald-300">
                           {(progress.speed/1024/1024).toFixed(2)} MB/s
                         </span>
                      </div>
                   </div>
                ) : (
                   <div className="flex flex-col items-center justify-center text-emerald-400 animate-pulse mt-12">
                      <Loader2 className="w-10 h-10 animate-spin mb-4" />
                      <p>Connecting and waiting for data...</p>
                   </div>
                )}
             </div>
          ) : (!selectedUser && !progress) ? (
             <div className="flex-1 flex flex-col items-center justify-center text-center opacity-50">
                <FileUp className="w-16 h-16 mb-4 text-zinc-400" />
                <h3 className="text-xl font-bold mb-2">Select a peer</h3>
                <p>Click on someone in the room to send them a file.</p>
             </div>
          ) : (
             <div className="flex-1">
                <h2 className="text-2xl font-bold mb-6">
                   Transfer to <span className="text-purple-400 font-mono">{selectedUser}</span>
                </h2>

                {/* Transfer Progress View */}
                {progress || requestStatus === 'accepted' ? (
                   <div className="mt-8">
                      <div className="mb-4 flex items-center justify-between">
                         <span className="text-sm font-medium text-emerald-400 flex items-center">
                           <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Transferring...
                         </span>
                      </div>
                      <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden border border-white/5 mb-2">
                         <div 
                           className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                           style={{ width: `${progress?.progress || 0}%` }}
                         />
                      </div>
                      {progress && (
                        <div className="flex justify-between items-center text-xs text-zinc-500 font-mono">
                          <span>{(progress.bytesTransferred/1024/1024).toFixed(2)} MB / {(progress.totalBytes/1024/1024).toFixed(2)} MB</span>
                          <span className="bg-black/30 px-2 py-1 rounded text-purple-300">
                            {(progress.speed/1024/1024).toFixed(2)} MB/s
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
                          <button onClick={() => setFileToShare(null)} className="text-zinc-400 hover:text-white text-sm">Change</button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center justify-center p-8 border-2 border-dashed border-white/20 hover:border-purple-500/50 hover:bg-white/5 rounded-2xl transition-all"
                        >
                          <FileUp className="w-8 h-8 mr-4 text-zinc-400" />
                          <span className="text-lg text-zinc-300 font-medium">Click to choose a file</span>
                        </button>
                      )}

                      {requestStatus === 'rejected' && (
                         <div className="text-rose-400 text-sm text-center bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">
                           {selectedUser} declined your file structure.
                         </div>
                      )}

                      <button 
                        onClick={handleSendRequest}
                        disabled={!fileToShare || isRequesting}
                        className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-bold transition-colors shadow-lg shadow-purple-900/20 flex justify-center items-center"
                      >
                         {isRequesting ? (
                           <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Waiting for {selectedUser} to accept...</>
                         ) : (
                           'Ask to Send File'
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
