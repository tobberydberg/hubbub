import type { SignalData } from './signaling'

// One WebRTC connection to the media server: our own published stream, or one subscribed stream
// of another participant. The signaling server routes our messages to the right Janus handle.

export type Signal = (data: SignalData) => void

export class PeerLink {
  readonly pc: RTCPeerConnection
  private pendingCandidates: RTCIceCandidateInit[] = []
  private remoteSet = false
  closed = false

  constructor(
    /** Session of the publisher: our own for our stream, the other participant's otherwise */
    readonly publisherId: string,
    readonly sid: string,
    readonly roomType: 'video' | 'screen',
    iceServers: RTCIceServer[],
    private readonly signal: Signal
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return
      this.send('candidate', {
        candidate: {
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex
        }
      })
    }
  }

  send(type: string, payload?: unknown): void {
    this.signal({ to: this.publisherId, sid: this.sid, roomType: this.roomType, type, payload })
  }

  /** Publisher side: create and send our offer. */
  async offer(nick: string): Promise<void> {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.send('offer', { type: 'offer', sdp: offer.sdp, nick })
  }

  async acceptAnswer(sdp: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'answer', sdp })
    await this.flushCandidates()
  }

  /** Subscriber side: answer the media server's offer. */
  async answer(sdp: string, nick: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: 'offer', sdp })
    await this.flushCandidates()
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    this.send('answer', { type: 'answer', sdp: answer.sdp, nick })
  }

  async addCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteSet) {
      this.pendingCandidates.push(candidate)
      return
    }
    await this.pc.addIceCandidate(candidate).catch(() => undefined)
  }

  private async flushCandidates(): Promise<void> {
    this.remoteSet = true
    for (const c of this.pendingCandidates.splice(0)) {
      await this.pc.addIceCandidate(c).catch(() => undefined)
    }
  }

  close(): void {
    this.closed = true
    this.pc.close()
  }
}

/** ICE servers from the signaling settings, in the shape RTCPeerConnection wants. */
export function iceServers(settings: {
  stunservers: { urls: string[] }[]
  turnservers: { urls: string[]; username: string; credential: string }[]
}): RTCIceServer[] {
  return [
    ...settings.stunservers.map((s) => ({ urls: s.urls })),
    ...settings.turnservers.map((t) => ({ urls: t.urls, username: t.username, credential: t.credential }))
  ]
}
