import { SignalingMessage } from '@/types/webrtc';

export class SignalingChannel {
  private channel: BroadcastChannel;
  private peerId: string;
  public onMessage?: (msg: SignalingMessage) => void;

  constructor(peerId: string) {
    this.peerId = peerId;
    this.channel = new BroadcastChannel('webrtc_signaling_channel');
    this.channel.onmessage = (event) => {
      if (this.onMessage) {
        this.onMessage(event.data);
      }
    };
    
    // Announce presence
    this.send({ type: 'peer-join', peerId: this.peerId } as any);
  }

  public send(message: SignalingMessage) {
    this.channel.postMessage(message);
  }

  public close() {
    this.send({ type: 'peer-leave', peerId: this.peerId } as any);
    this.channel.close();
  }
}
