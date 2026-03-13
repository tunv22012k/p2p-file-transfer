'use client';

import { useWebRTC } from '@/hooks/useWebRTC';
import { importKeyString } from '@/lib/crypto';
import { Download, Loader2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function ShareReceiverPage() {
  const { 
    status, progress, connectToPeer, setCryptoKey,
    incomingFileMetadata, acceptFileTransfer
  } = useWebRTC();
  const pathname = usePathname();
  const [error, setError] = useState('');
  
  // Extract Target Peer ID and Crypto Key on load
  useEffect(() => {
    // pathname like /share/xyz123
    const targetPeerId = pathname.split('/').pop();
    // the hash looks like #aB3dEf...
    const hash = window.location.hash.slice(1);

    if (!targetPeerId || !hash) {
      setError('Invalid sharing link. Missing peer ID or decryption key.');
      return;
    }

    // Import the key and alert the hooks, then initiate connection
    importKeyString(hash)
      .then(key => {
        setCryptoKey(key);
        connectToPeer(targetPeerId);
      })
      .catch(err => {
        console.error("Failed to import key:", err);
        setError('Invalid decryption key in URL.');
      });
      
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl text-center">
        
        {error ? (
           <div className="text-rose-400 p-4 border border-rose-500/30 bg-rose-500/10 rounded-xl mb-4">
             {error}
           </div>
        ) : (
           <>
             <div className="mx-auto w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex flex-col items-center justify-center mb-6">
                <Download className="w-8 h-8" />
             </div>
             
             <h1 className="text-2xl font-bold text-white mb-2">Downloading File</h1>
             <p className="text-zinc-400 mb-8">
               Waiting for the sender to initiate the transfer. You will be prompted to choose where to save the file.
             </p>

             <div className="p-4 bg-black/30 border border-white/5 rounded-2xl mb-6">
               <div className="flex justify-between items-center mb-4">
                  <span className="text-zinc-400 text-sm">Status</span>
                  <span className={`text-sm font-medium flex items-center ${
                     status === 'Connected' ? 'text-emerald-400' :
                     status === 'Connecting' ? 'text-yellow-400' :
                     'text-zinc-500'
                  }`}>
                     {status === 'Connecting' && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                     {status}
                  </span>
               </div>
               
               {progress && (
                 <div>
                    <div className="flex justify-between text-xs mb-1 text-zinc-500">
                      <span>Downloading...</span>
                      <span>{progress.progress.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden mb-2">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300" 
                        style={{width: `${progress.progress}%`}}
                      />
                    </div>
                 </div>
               )}
             </div>

             {incomingFileMetadata && !progress && (
                <div className="animate-in fade-in slide-in-from-bottom-4">
                   <div className="bg-purple-500/10 border border-purple-500/30 text-purple-300 p-4 rounded-xl mb-4 text-sm font-medium">
                      Incoming: {incomingFileMetadata.name} ({Math.ceil(incomingFileMetadata.size / 1024).toLocaleString()} KB)
                   </div>
                   <button 
                     onClick={acceptFileTransfer}
                     className="w-full bg-blue-600 hover:bg-blue-500 text-white px-6 py-4 rounded-xl font-bold transition-colors flex justify-center items-center shadow-lg shadow-blue-500/20"
                   >
                     <Download className="w-5 h-5 mr-2" />
                     Save File to Device
                   </button>
                </div>
             )}
           </>
        )}

      </div>
    </div>
  );
}
