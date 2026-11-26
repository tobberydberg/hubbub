import { InCall, type Room, type SignalingSettings } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { setApp, showToast, useApp, type AccountState } from '@renderer/store/app'
import { updateCall, useCall, type CallParticipant, type ModeratorRequest } from '@renderer/store/call'
import { usePrefs } from '@renderer/store/prefs'
import { setTyping, typingKey } from '@renderer/store/typing'
import { holdPresence, presenceYielded } from '@renderer/sync/presence'
import { iceServers, PeerLink } from './peer'
import { callUnsupportedReason } from './rules'
import { HpbSignaling, type CallUpdate, type JoinedSession, type SignalData } from './signaling'
import type { BackgroundBlur } from './blur'
import { openCameraTrack, openMicrophoneStream } from './devices'
import { SpeakingDetector } from './speaking'
import { openRoom, sendMessage } from '@renderer/sync/actions'
import { canModerate } from '@renderer/sync/moderation'
import { getSync } from '@renderer/sync/engine'

// A call in one conversation: the conversation session on the Nextcloud server, the connection to
// the signaling server, our published microphone and camera, and one subscription per other
// participant, all through the media server of the High-Performance Backend.

const OFFER_RETRY = 10_000
/** Our media state and name are re-sent to joiners, as media server offers carry no name */
const STATE_REPEAT = [0, 1000, 2000, 4000, 8000, 16000]
/** Attendee permissions */
const PUBLISH_AUDIO = 32
const PUBLISH_VIDEO = 64
const PUBLISH_SCREEN = 128

/**
 * Simulcast: our camera in three qualities, so the media server can send each viewer what fits
 * their tile. Same layers and bitrates as Talk on the web; the media server expects high to low.
 */
const SIMULCAST_LAYERS: RTCRtpEncodingParameters[] = [
  { rid: 'h', maxBitrate: 900_000 },
  { rid: 'm', maxBitrate: 300_000, scaleResolutionDownBy: 2 },
  { rid: 'l', maxBitrate: 100_000, scaleResolutionDownBy: 4 }
]

/** Simulcast layer to receive for a tile of this width (0 low, 1 medium, 2 high) */
export function layerForWidth(width: number): number {
  return width >= 640 ? 2 : width >= 280 ? 1 : 0
}

/**
 * What carries over when a call moves to another conversation (adding people to a one-to-one call):
 * the running microphone, camera and screen share, and how the call was shown.
 */
export interface CallHandover {
  microphone: MediaStream | null
  camera: MediaStreamTrack | null
  /** Keeps blurring the camera, so the video doesn't flicker */
  blur: BackgroundBlur | null
  screen: MediaStream | null
  muted: boolean
  expanded: boolean
  poppedOut: boolean
}

/** The call can't be made in Hubbub; the message says why, and the browser is the fallback. */
export class CallUnsupported extends Error {}

class Cancelled extends Error {}

function confirm(opts: { title: string; body: string; confirmLabel: string }): Promise<boolean> {
  return new Promise((resolve) => {
    setApp((s) => {
      s.modal = {
        type: 'confirm',
        ...opts,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      }
    })
  })
}

// Media streams live outside the store; components look them up by session id
const streams = new Map<string, MediaStream>()
const SELF = 'self'

/** Key of the screen stream of a participant, or of our own */
export const screenKey = (sessionId: string): string => `${sessionId}:screen`

/** The camera stream of a participant (by signaling session id) or our own ('self'); screens by screenKey(). */
export function callStream(key: string): MediaStream | undefined {
  return streams.get(key)
}

function bumpStream(key: string): void {
  const sessionId = key.replace(/:screen$/, '')
  useCall.setState((s) => {
    if (!s.active) return
    if (sessionId === SELF) s.active.selfStreamVersion++
    else if (s.active.participants[sessionId]) s.active.participants[sessionId].streamVersion++
  })
}

class CallSession {
  private readonly api
  private signaling: HpbSignaling | null = null
  private settings!: SignalingSettings
  private ice: RTCIceServer[] = []
  private ncSession = ''
  private joined = false
  private ended = false
  private microphone: MediaStream | null = null
  private camera: MediaStreamTrack | null = null
  /** The camera with its background blurred, when turned on */
  private blur: BackgroundBlur | null = null
  private canPublishVideo = false
  private publisher: PeerLink | null = null
  private screenPublisher: PeerLink | null = null
  private screen: MediaStream | null = null
  private videoSender: RTCRtpSender | null = null
  private audioSender: RTCRtpSender | null = null
  private statusChannel: RTCDataChannel | null = null
  /** Our subscriptions by stream key: session id for cameras, screenKey() for screens */
  private readonly subscribers = new Map<string, PeerLink>()
  /** What we receive from each subscription, as last told to the media server: layer, or -1 for no video */
  private readonly videoSelected = new Map<string, number>()
  /** What the call view shows: stream key → simulcast layer */
  private wantedVideo = new Map<string, number>()
  private readonly offerTimers = new Map<string, ReturnType<typeof setInterval>>()
  private readonly players = new Map<string, HTMLAudioElement>()
  private readonly detectors = new Map<string, SpeakingDetector>()
  private readonly names = new Map<string, { name: string; userId?: string }>()
  private readonly remotes = new Set<string>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    readonly accountId: string,
    readonly token: string,
    private readonly handover?: CallHandover
  ) {
    this.api = talk(accountId)
  }

  private get account(): AccountState {
    return useApp.getState().accounts[this.accountId]
  }

  private get selfId(): string {
    return this.signaling?.sessionId ?? ''
  }

  private nick(): string {
    return this.account.user?.displayname ?? ''
  }

  private get state(): { muted: boolean; videoOn: boolean } {
    const a = useCall.getState().active
    return { muted: !!a?.muted || !this.microphone, videoOn: !!a?.videoOn }
  }

  async start(silent: boolean): Promise<void> {
    const room = this.account.rooms[this.token]
    const handover = this.handover
    this.microphone = handover ? handover.microphone : await this.openMicrophone(room)
    for (const t of this.microphone?.getAudioTracks() ?? []) t.enabled = !handover?.muted
    this.canPublishVideo =
      !(room.permissions && !(room.permissions & PUBLISH_VIDEO)) &&
      (await navigator.mediaDevices.enumerateDevices()).some((d) => d.kind === 'videoinput')
    if (handover?.camera && this.canPublishVideo) {
      this.camera = handover.camera
      this.blur = handover.blur
      streams.set(SELF, new MediaStream([this.outgoingVideo!]))
    } else {
      handover?.blur?.stop()
      handover?.camera?.stop()
    }
    updateCall((c) => {
      c.videoOn = !!this.camera
      c.selfStreamVersion++
      c.listenOnly = !this.microphone
      c.cameraAvailable = this.canPublishVideo
      c.canShareScreen = !(room.permissions && !(room.permissions & PUBLISH_SCREEN))
    })

    this.settings = await this.api.signalingSettings(this.token)
    if (this.settings.signalingMode !== 'external' || !this.settings.server) {
      throw new CallUnsupported(
        'This server has no High-Performance Backend; calls in Hubbub need one for now'
      )
    }
    this.ice = iceServers(this.settings)
    this.signaling = new HpbSignaling(
      this.account.info.serverUrl,
      this.settings,
      () => this.api.signalingSettings(this.token),
      {
        message: (from, data) => void this.onMessage(from, data),
        join: (sessions) => this.onJoin(sessions),
        leave: (ids) => ids.forEach((id) => this.removeRemote(id)),
        participants: (u) => this.onParticipants(u),
        reset: () => void this.renegotiate(),
        connection: (state) => updateCall((c) => void (c.status = state)),
        closed: () => void this.end('You were removed from the call'),
        // A moderator started or stopped breakout rooms: continue the call in the other conversation
        switchTo: (target) => void switchCallTo(this.accountId, target)
      }
    )
    await this.signaling.connect()
    if (!this.signaling.features.includes('mcu')) {
      throw new CallUnsupported('This server has no media server; calls in Hubbub need one for now')
    }

    // Our presence in the conversation (for typing) has to be gone first, see presence.ts
    await presenceYielded(this.accountId)
    this.ncSession = await this.joinSession()
    await this.signaling.joinRoom(this.token, this.ncSession)

    const consent = await this.recordingConsent(room)
    const flags =
      InCall.InCall | (this.microphone ? InCall.Audio : 0) | (this.canPublishVideo ? InCall.Video : 0)
    await this.api.joinCall(this.token, { flags, silent, ...(consent ? { recordingConsent: true } : {}) })
    this.joined = true
    updateCall((c) => void (c.status = 'connected'))
    void window.hubbub.calls.setActive(true)
    await this.publish()
    if (handover?.screen) await this.shareStream(handover.screen)
  }

  private async openMicrophone(room: Room): Promise<MediaStream | null> {
    if (room.permissions && !(room.permissions & PUBLISH_AUDIO)) return null
    if (!(await window.hubbub.calls.mediaAccess('microphone'))) {
      showToast('Hubbub has no access to the microphone. Allow it in your system settings.', 'error')
      return null
    }
    try {
      return await openMicrophoneStream(usePrefs.getState().microphoneId)
    } catch {
      showToast('No microphone available, joining without audio', 'error')
      return null
    }
  }

  private async openCamera(): Promise<MediaStreamTrack | null> {
    if (!(await window.hubbub.calls.mediaAccess('camera'))) {
      showToast('Hubbub has no access to the camera. Allow it in your system settings.', 'error')
      return null
    }
    try {
      return await openCameraTrack(usePrefs.getState().cameraId)
    } catch {
      showToast('The camera could not be started', 'error')
      return null
    }
  }

  private async joinSession(): Promise<string> {
    let res = await this.api.joinSession(this.token, false)
    if (res.status === 409) {
      const join = await confirm({
        title: 'Already in this call',
        body: 'You are in this call on another device or in your browser. Join here instead? You will leave the call there.',
        confirmLabel: 'Join here'
      })
      if (!join) throw new Cancelled()
      res = await this.api.joinSession(this.token, true)
    }
    if (!res.ok || !res.data) throw new Error(res.error || 'Could not join the conversation')
    return res.data.sessionId
  }

  private async recordingConsent(room: Room): Promise<boolean> {
    const config = this.account.caps?.config.call as { 'recording-consent'?: number } | undefined
    const mode = config?.['recording-consent'] ?? 0
    if (!(mode === 1 || (mode === 2 && room.recordingConsent === 1))) return false
    const ok = await confirm({
      title: 'This call may be recorded',
      body: 'A moderator can record this call. By joining you agree to being recorded.',
      confirmLabel: 'Agree and join'
    })
    if (!ok) throw new Cancelled()
    return true
  }

  // --- Publishing ---------------------------------------------------------------

  /**
   * Publishes the microphone and, when we have a camera, a video channel. The camera is switched
   * on and off by replacing the video track, so that needs no new negotiation.
   */
  private async publish(): Promise<void> {
    if ((!this.microphone && !this.canPublishVideo) || !this.signaling) return
    const self = this.selfId
    const link = new PeerLink(self, String(Date.now()), 'video', this.ice, (d) =>
      this.signaling?.sendToSession(self, d)
    )
    const outgoing = new MediaStream()
    for (const track of this.microphone?.getAudioTracks() ?? []) {
      outgoing.addTrack(track)
      this.audioSender = link.pc.addTrack(track, outgoing)
    }
    if (this.canPublishVideo) {
      const simulcast = this.signaling.features.includes('simulcast')
      const transceiver = link.pc.addTransceiver(this.outgoingVideo ?? 'video', {
        direction: 'sendonly',
        streams: [outgoing],
        sendEncodings: simulcast ? SIMULCAST_LAYERS : [{ maxBitrate: 900_000 }]
      })
      this.videoSender = transceiver.sender
    }
    const channel = link.pc.createDataChannel('status')
    channel.onopen = () => this.broadcastState()
    this.statusChannel = channel
    link.pc.onconnectionstatechange = () => {
      if (link.pc.connectionState === 'failed' && this.publisher === link) void this.republish()
    }
    this.publisher = link
    this.watchSelf()
    await link.offer(this.nick())
  }

  /** Whether we are speaking, for our own tile and for the others */
  private watchSelf(): void {
    if (!this.microphone) return
    this.watchSpeaking(SELF, this.microphone, (speaking) => {
      updateCall((c) => void (c.speaking = speaking))
      if (!this.state.muted) this.sendStatus(speaking ? 'speaking' : 'stoppedSpeaking')
    })
  }

  private async republish(): Promise<void> {
    this.publisher?.close()
    this.publisher = null
    this.videoSender = null
    this.audioSender = null
    await this.publish().catch(() => undefined)
  }

  private sendStatus(type: string, payload?: unknown): void {
    if (this.statusChannel?.readyState !== 'open') return
    this.statusChannel.send(JSON.stringify(payload === undefined ? { type } : { type, payload }))
  }

  /** Our state on the data channel, which the media server forwards to every subscriber. */
  private broadcastState(): void {
    const { muted, videoOn } = this.state
    this.sendStatus(muted ? 'audioOff' : 'audioOn')
    this.sendStatus(videoOn ? 'videoOn' : 'videoOff')
    const userId = this.account.user?.id
    this.sendStatus('nickChanged', userId ? { name: this.nick(), userid: userId } : this.nick())
  }

  // --- Receiving ----------------------------------------------------------------

  private requestOffer(publisherId: string): void {
    if (this.offerTimers.has(publisherId)) return
    const ask = (): void =>
      this.signaling?.sendToSession(publisherId, { type: 'requestoffer', roomType: 'video' })
    ask()
    this.offerTimers.set(publisherId, setInterval(ask, OFFER_RETRY))
  }

  private stopOfferRequests(publisherId: string): void {
    clearInterval(this.offerTimers.get(publisherId))
    this.offerTimers.delete(publisherId)
  }

  /** Answers the media server's offer for a stream: `key` is the publisher's session id, or screenKey() of it. */
  private async subscribe(key: string, publisherId: string, sid: string, sdp: string): Promise<void> {
    const screen = key !== publisherId
    if (!screen) this.stopOfferRequests(publisherId)
    const existing = this.subscribers.get(key)
    if (existing && existing.sid === sid) {
      // Renegotiation of the same connection
      await existing.answer(sdp, this.nick())
      return
    }
    existing?.close()
    const link = new PeerLink(publisherId, sid, screen ? 'screen' : 'video', this.ice, (d) =>
      this.signaling?.sendToSession(publisherId, d)
    )
    link.pc.ontrack = (e) => this.onTrack(key, e)
    if (!screen) {
      link.pc.ondatachannel = (e) => {
        e.channel.onmessage = (m) => this.onStatus(publisherId, String(m.data))
      }
    }
    link.pc.onconnectionstatechange = () => {
      const state = link.pc.connectionState
      if (this.subscribers.get(key) !== link) return
      if (!screen) this.setParticipant(publisherId, { connected: state === 'connected' })
      if (state === 'failed') {
        this.dropSubscription(key)
        if (!screen && this.remotes.has(publisherId)) this.requestOffer(publisherId)
      }
    }
    this.subscribers.set(key, link)
    this.videoSelected.delete(key)
    if (screen) this.setParticipant(publisherId, { screen: true, screenSince: Date.now() })
    await link.answer(sdp, this.nick())
    this.selectVideo(key)
  }

  private dropSubscription(key: string): void {
    this.subscribers.get(key)?.close()
    this.subscribers.delete(key)
    this.videoSelected.delete(key)
    const el = this.players.get(key)
    if (el && key.endsWith(':screen')) {
      el.pause()
      el.srcObject = null
      this.players.delete(key)
    }
    if (key.endsWith(':screen')) {
      streams.delete(key)
      this.setParticipant(key.replace(/:screen$/, ''), { screen: false })
    }
  }

  private onTrack(key: string, e: RTCTrackEvent): void {
    const stream = e.streams[0] ?? streams.get(key) ?? new MediaStream()
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track)
    streams.set(key, stream)
    // Screens can come with sound, e.g. a video in a shared browser tab
    if (e.track.kind === 'audio') this.play(key, stream)
    bumpStream(key)
  }

  private play(sessionId: string, stream: MediaStream): void {
    const prev = this.players.get(sessionId)
    if (prev?.srcObject === stream) return
    prev?.pause()
    const el = new Audio()
    el.autoplay = true
    el.srcObject = stream
    const speaker = usePrefs.getState().speakerId
    if (speaker) void el.setSinkId(speaker).catch(() => undefined)
    void el.play().catch(() => undefined)
    this.players.set(sessionId, el)
    if (sessionId.endsWith(':screen')) return
    this.watchSpeaking(sessionId, stream, (speaking) =>
      this.setParticipant(sessionId, speaking ? { speaking, lastSpokeAt: Date.now() } : { speaking })
    )
  }

  /**
   * Only download video that is on screen, in the quality that fits its tile: tells the media
   * server to pause, resume or switch the stream.
   */
  private selectVideo(key: string): void {
    const link = this.subscribers.get(key)
    const features = this.signaling?.features ?? []
    if (!link || !features.includes('update-sdp')) return
    const layer = this.wantedVideo.get(key) ?? -1
    const prev = this.videoSelected.get(key)
    if (prev === layer) return
    this.videoSelected.set(key, layer)
    const payload: Record<string, unknown> = {}
    if (prev === undefined || prev < 0 !== layer < 0) payload.video = layer >= 0
    // Screens are sent in one quality
    if (layer >= 0 && features.includes('simulcast') && !key.endsWith(':screen')) {
      payload.substream = layer
      payload.temporal = 2
    }
    if (Object.keys(payload).length) link.send('selectStream', payload)
  }

  setVisibleVideos(layers: Record<string, number>): void {
    this.wantedVideo = new Map(Object.entries(layers))
    for (const id of this.subscribers.keys()) this.selectVideo(id)
  }

  private watchSpeaking(id: string, stream: MediaStream, onChange: (speaking: boolean) => void): void {
    this.detectors.get(id)?.stop()
    this.detectors.set(id, new SpeakingDetector(stream, onChange))
  }

  /** The media server changed under us (new signaling session): connect everything again. */
  private async renegotiate(): Promise<void> {
    for (const key of [...this.subscribers.keys()]) this.dropSubscription(key)
    if (this.screen) this.stopScreenShare()
    for (const id of this.offerTimers.keys()) this.stopOfferRequests(id)
    await this.republish()
    for (const id of this.remotes) this.requestOffer(id)
  }

  // --- Signaling --------------------------------------------------------------

  private async onMessage(from: string, data: SignalData): Promise<void> {
    const payload = (data.payload ?? {}) as Record<string, unknown>
    switch (data.type) {
      case 'answer': {
        const own = data.roomType === 'screen' ? this.screenPublisher : this.publisher
        if (from === this.selfId && own && data.sid === own.sid) await own.acceptAnswer(String(payload.sdp))
        break
      }
      case 'offer':
        if (!data.sid || from === this.selfId) break
        if (data.roomType === 'screen')
          await this.subscribe(screenKey(from), from, data.sid, String(payload.sdp))
        else await this.subscribe(from, from, data.sid, String(payload.sdp))
        break
      case 'candidate': {
        const screen = data.roomType === 'screen'
        const link =
          from === this.selfId
            ? screen
              ? this.screenPublisher
              : this.publisher
            : this.subscribers.get(screen ? screenKey(from) : from)
        if (link && link.sid === data.sid) await link.addCandidate(payload.candidate as RTCIceCandidateInit)
        break
      }
      case 'unshareScreen':
        if (from !== this.selfId) this.dropSubscription(screenKey(from))
        break
      case 'mute':
      case 'unmute':
        if (payload.name === 'audio') this.setParticipant(from, { muted: data.type === 'mute' })
        if (payload.name === 'video') this.setParticipant(from, { videoOn: data.type === 'unmute' })
        break
      case 'nickChanged':
        if (typeof payload.name === 'string') this.setName(from, payload.name)
        break
      case 'startedTyping':
      case 'stoppedTyping': {
        const who = this.names.get(from)
        if (!who || who.userId === this.account.user?.id) break
        setTyping(typingKey(this.accountId, this.token), from, data.type === 'startedTyping' ? who : null)
        break
      }
      case 'raiseHand':
        this.setParticipant(from, {
          handRaisedAt: payload.state ? Number(payload.timestamp) || Date.now() : 0
        })
        break
      case 'hubbub-moderator-request': {
        // Only moderators answer; a request from a guest can't be granted (they have no user id)
        const room = useApp.getState().accounts[this.accountId]?.rooms[this.token]
        const userId = typeof payload.userId === 'string' ? payload.userId : ''
        if (!userId || !canModerate(room) || from === this.selfId) break
        const name = typeof payload.name === 'string' && payload.name ? payload.name : userId
        updateCall((c) => {
          c.moderatorRequests = [
            ...c.moderatorRequests.filter((r) => r.userId !== userId),
            { sessionId: from, userId, name, at: Date.now() }
          ]
        })
        break
      }
      case 'hubbub-moderator-answer': {
        if (useCall.getState().active?.moderatorAsk?.state !== 'waiting') break
        const granted = payload.granted === true
        updateCall((c) => void (c.moderatorAsk = { state: granted ? 'granted' : 'declined', at: Date.now() }))
        if (granted) {
          showToast('You’re now a moderator')
          void getSync(this.accountId)?.refreshRooms()
        } else {
          showToast('A moderator answered: not now')
        }
        break
      }
      case 'transcript':
        // Live captions: { speakerSessionId, message, langId, final }
        if (typeof data.message === 'string' && typeof data.speakerSessionId === 'string') {
          const name =
            data.speakerSessionId === this.selfId
              ? 'You'
              : (useCall.getState().active?.participants[data.speakerSessionId]?.name ?? '')
          showCaption(data.speakerSessionId, name, data.message, data.final !== false)
        }
        break
      case 'reaction':
        if (typeof payload.reaction === 'string') {
          const name = useCall.getState().active?.participants[from]?.name ?? ''
          showReaction(from, name, payload.reaction)
        }
        break
      case 'control':
        if (payload.action === 'forceMute') {
          if (payload.peerId === this.selfId) {
            setMuted(true)
            showToast('A moderator muted you')
          } else if (typeof payload.peerId === 'string') {
            this.setParticipant(payload.peerId, { muted: true })
          }
        }
        break
    }
  }

  private onStatus(sessionId: string, raw: string): void {
    let msg: { type?: string; payload?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    switch (msg.type) {
      case 'audioOn':
      case 'audioOff':
        this.setParticipant(sessionId, { muted: msg.type === 'audioOff' })
        break
      case 'videoOn':
      case 'videoOff':
        this.setParticipant(sessionId, { videoOn: msg.type === 'videoOn' })
        break
      case 'nickChanged': {
        const p = msg.payload
        const name = typeof p === 'string' ? p : (p as { name?: string } | null)?.name
        if (name) this.setName(sessionId, name)
        break
      }
    }
  }

  private onJoin(sessions: JoinedSession[]): void {
    for (const s of sessions) {
      const name = s.user?.displayname || s.userid || 'Guest'
      this.names.set(s.sessionid, { name, userId: s.userid })
      if (this.remotes.has(s.sessionid)) this.setName(s.sessionid, name)
    }
  }

  private onParticipants(update: {
    changed?: CallUpdate[]
    users?: CallUpdate[]
    all?: boolean
    incall?: number
  }): void {
    if (update.all && update.incall === 0) {
      void this.end('The call was ended for everyone')
      return
    }
    const list = update.changed ?? update.users ?? []
    if (update.users && !update.changed) {
      const present = new Set(update.users.filter((u) => u.inCall & InCall.InCall).map((u) => u.sessionId))
      for (const id of this.remotes) if (!present.has(id)) this.removeRemote(id)
    }
    for (const p of list) {
      if (p.sessionId === this.selfId || p.internal) continue
      if (p.inCall & InCall.InCall) this.addRemote(p)
      else this.removeRemote(p.sessionId)
    }
  }

  private addRemote(p: CallUpdate): void {
    const isNew = !this.remotes.has(p.sessionId)
    this.remotes.add(p.sessionId)
    const known = this.names.get(p.sessionId)
    useCall.setState((s) => {
      if (!s.active) return
      const prev = s.active.participants[p.sessionId]
      s.active.participants[p.sessionId] = {
        sessionId: p.sessionId,
        name: prev?.name || known?.name || p.displayName || p.actorId || 'Guest',
        userId: known?.userId ?? p.userId,
        inCall: p.inCall,
        muted: prev?.muted ?? !(p.inCall & InCall.Audio),
        videoOn: prev?.videoOn ?? false,
        speaking: prev?.speaking ?? false,
        connected: prev?.connected ?? false,
        joinedAt: prev?.joinedAt ?? Date.now(),
        lastSpokeAt: prev?.lastSpokeAt ?? 0,
        handRaisedAt: prev?.handRaisedAt ?? 0,
        screen: prev?.screen ?? false,
        screenSince: prev?.screenSince ?? 0,
        streamVersion: prev?.streamVersion ?? 0
      }
    })
    if (isNew) {
      this.announceTo(p.sessionId)
      if (this.screenPublisher) this.offerScreenTo(p.sessionId)
    }
    if (p.inCall & (InCall.Audio | InCall.Video) && !this.subscribers.has(p.sessionId)) {
      this.requestOffer(p.sessionId)
    }
  }

  private removeRemote(sessionId: string): void {
    if (!this.remotes.delete(sessionId)) return
    this.stopOfferRequests(sessionId)
    this.dropSubscription(sessionId)
    this.dropSubscription(screenKey(sessionId))
    const el = this.players.get(sessionId)
    if (el) {
      el.pause()
      el.srcObject = null
    }
    this.players.delete(sessionId)
    this.detectors.get(sessionId)?.stop()
    this.detectors.delete(sessionId)
    streams.delete(sessionId)
    useCall.setState((s) => {
      if (s.active) delete s.active.participants[sessionId]
    })
  }

  /** Tells a participant who we are and what we send, a few times as they may still be connecting. */
  private announceTo(sessionId: string): void {
    for (const delay of STATE_REPEAT) {
      const t = setTimeout(() => {
        this.timers.delete(t)
        if (!this.remotes.has(sessionId)) return
        const { muted, videoOn } = this.state
        this.sendTo(sessionId, muted ? 'mute' : 'unmute', { name: 'audio' })
        this.sendTo(sessionId, videoOn ? 'unmute' : 'mute', { name: 'video' })
        this.sendTo(sessionId, 'nickChanged', { name: this.nick() })
        this.broadcastState()
      }, delay)
      this.timers.add(t)
    }
  }

  private sendTo(sessionId: string, type: string, payload?: unknown): void {
    this.signaling?.sendToSession(sessionId, { to: sessionId, roomType: 'video', type, payload })
  }

  private setParticipant(sessionId: string, patch: Partial<CallParticipant>): void {
    useCall.setState((s) => {
      const p = s.active?.participants[sessionId]
      if (p) Object.assign(p, patch)
    })
  }

  private setName(sessionId: string, name: string): void {
    const prev = this.names.get(sessionId)
    this.names.set(sessionId, { ...prev, name })
    this.setParticipant(sessionId, { name })
  }

  // --- Controls ---------------------------------------------------------------

  setMuted(muted: boolean): void {
    for (const t of this.microphone?.getAudioTracks() ?? []) t.enabled = !muted
    updateCall((c) => {
      c.muted = muted
      if (muted) c.speaking = false
    })
    if (!this.microphone) return
    for (const id of this.remotes) this.sendTo(id, muted ? 'mute' : 'unmute', { name: 'audio' })
    this.sendStatus(muted ? 'audioOff' : 'audioOn')
  }

  /** Typing signals to everyone in the conversation (not only the call), like Talk on the web. */
  sendTyping(typing: boolean): void {
    const selfId = this.account.user?.id
    for (const [sessionId, who] of this.names) {
      if (sessionId === this.selfId || (who.userId && who.userId === selfId)) continue
      this.signaling?.sendToSession(sessionId, {
        type: typing ? 'startedTyping' : 'stoppedTyping',
        to: sessionId
      })
    }
  }

  setHandRaised(state: boolean): void {
    updateCall((c) => void (c.handRaised = state))
    for (const id of this.remotes) this.sendTo(id, 'raiseHand', { state, timestamp: Date.now() })
  }

  /** Asks the moderators in the conversation to make us one */
  askToModerate(): void {
    const me = this.account.user
    for (const sessionId of this.names.keys()) {
      if (sessionId === this.selfId) continue
      this.signaling?.sendToSession(sessionId, {
        to: sessionId,
        roomType: 'video',
        type: 'hubbub-moderator-request',
        payload: { userId: me?.id, name: me?.displayname }
      })
    }
  }

  answerModeratorRequest(sessionId: string, granted: boolean): void {
    this.sendTo(sessionId, 'hubbub-moderator-answer', { granted })
  }

  react(emoji: string): void {
    for (const id of this.remotes) this.sendTo(id, 'reaction', { reaction: emoji })
    showReaction(SELF, 'You', emoji)
  }

  async setVideo(on: boolean): Promise<void> {
    if (!this.canPublishVideo || on === this.state.videoOn) return
    if (on) {
      const track = await this.openCamera()
      if (!track || this.ended) {
        track?.stop()
        return
      }
      this.camera = track
      if (usePrefs.getState().backgroundBlur) await this.updateBlur(false)
      if (this.camera !== track) return
      streams.set(SELF, new MediaStream([this.outgoingVideo!]))
      await this.videoSender?.replaceTrack(this.outgoingVideo)
    } else {
      await this.videoSender?.replaceTrack(null)
      this.blur?.stop()
      this.blur = null
      // Stopping the track turns the camera light off
      this.camera?.stop()
      this.camera = null
      streams.delete(SELF)
    }
    updateCall((c) => void (c.videoOn = on))
    bumpStream(SELF)
    for (const id of this.remotes) this.sendTo(id, on ? 'unmute' : 'mute', { name: 'video' })
    this.sendStatus(on ? 'videoOn' : 'videoOff')
  }

  /** Switches to another microphone during the call (the preference is already set). */
  async switchMicrophone(): Promise<void> {
    const room = this.account.rooms[this.token]
    if (this.ended || (room?.permissions && !(room.permissions & PUBLISH_AUDIO))) return
    let stream: MediaStream
    try {
      stream = await openMicrophoneStream(usePrefs.getState().microphoneId)
    } catch {
      showToast('That microphone could not be started', 'error')
      return
    }
    if (this.ended) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const track = stream.getAudioTracks()[0]
    const muted = !!useCall.getState().active?.muted
    track.enabled = !muted
    const previous = this.microphone
    this.microphone = stream
    // Without a microphone so far there is nothing to replace: publish again, with audio
    if (this.audioSender) await this.audioSender.replaceTrack(track)
    else await this.republish()
    previous?.getTracks().forEach((t) => t.stop())
    this.watchSelf()
    updateCall((c) => void (c.listenOnly = false))
    if (!previous)
      for (const id of this.remotes) this.sendTo(id, muted ? 'mute' : 'unmute', { name: 'audio' })
  }

  /** Switches to another camera during the call; with the camera off, it is used next time. */
  async switchCamera(): Promise<void> {
    if (!this.camera || this.ended) return
    const track = await this.openCamera()
    if (!track || this.ended || !this.camera) {
      track?.stop()
      return
    }
    const previous = this.camera
    const previousBlur = this.blur
    this.camera = track
    this.blur = null
    if (usePrefs.getState().backgroundBlur) await this.updateBlur(false)
    if (this.camera !== track) return
    streams.set(SELF, new MediaStream([this.outgoingVideo!]))
    await this.videoSender?.replaceTrack(this.outgoingVideo)
    bumpStream(SELF)
    previousBlur?.stop()
    previous.stop()
  }

  /** Plays the call through another speaker (the preference is already set). */
  switchSpeaker(): void {
    const id = usePrefs.getState().speakerId ?? ''
    for (const el of this.players.values()) void el.setSinkId(id).catch(() => undefined)
  }

  /** What we send as our video: the camera, or the camera with its background blurred */
  private get outgoingVideo(): MediaStreamTrack | null {
    return this.blur?.track ?? this.camera
  }

  /**
   * Starts or stops blurring the camera as the preference says. `swap` puts the result on the call
   * right away; turning the camera on does that itself.
   */
  async updateBlur(swap = true): Promise<void> {
    const camera = this.camera
    const wanted = usePrefs.getState().backgroundBlur && !!camera
    if (wanted === !!this.blur) return
    if (wanted && camera) {
      try {
        const { BackgroundBlur } = await import('./blur')
        const blur = await BackgroundBlur.create(camera)
        // The camera went off, or blur was turned off again, while the model loaded
        if (this.camera !== camera || this.ended || !usePrefs.getState().backgroundBlur || this.blur) {
          blur.stop()
          return
        }
        this.blur = blur
      } catch (err) {
        console.warn('Background blur failed', err)
        showToast('Your background could not be blurred', 'error')
        return
      }
    } else {
      this.blur?.stop()
      this.blur = null
    }
    if (!swap || !this.camera) return
    streams.set(SELF, new MediaStream([this.outgoingVideo!]))
    await this.videoSender?.replaceTrack(this.outgoingVideo)
    bumpStream(SELF)
  }

  async startScreenShare(sourceId: string): Promise<void> {
    if (!this.signaling || this.screen) return
    await window.hubbub.calls.chooseScreen(sourceId)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 15 } },
        audio: false
      })
    } catch {
      showToast('The screen could not be shared', 'error')
      return
    }
    await this.shareStream(stream)
  }

  private async shareStream(stream: MediaStream): Promise<void> {
    if (this.ended || !this.signaling) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const track = stream.getVideoTracks()[0]
    // Text stays sharp rather than smooth
    track.contentHint = 'detail'
    // The operating system's "Stop sharing" ends the track
    track.onended = () => this.stopScreenShare()
    this.screen = stream
    streams.set(screenKey(SELF), stream)
    const self = this.selfId
    const link = new PeerLink(self, String(Date.now()), 'screen', this.ice, (d) =>
      this.signaling?.sendToSession(self, d)
    )
    link.pc.addTrack(track, stream)
    let announced = false
    link.pc.onconnectionstatechange = () => {
      // Others can't know a screen is shared: ask the media server to offer it to each of them
      if (link.pc.connectionState === 'connected' && !announced && this.screenPublisher === link) {
        announced = true
        for (const id of this.remotes) this.offerScreenTo(id)
      }
    }
    this.screenPublisher = link
    updateCall((c) => {
      c.sharing = true
      c.selfStreamVersion++
    })
    await link.offer(this.nick())
  }

  private offerScreenTo(sessionId: string): void {
    this.signaling?.sendToSession(sessionId, { type: 'sendoffer', roomType: 'screen' })
  }

  /** Stops sharing; `keepCapture` leaves the capture running, to hand it over to another call. */
  stopScreenShare(keepCapture = false): void {
    const link = this.screenPublisher
    if (!link && !this.screen) return
    this.screenPublisher = null
    if (link) {
      this.signaling?.sendToRoom({ type: 'unshareScreen', roomType: 'screen' })
      // Over our own screen connection, which makes the media server close it
      link.send('unshareScreen')
      link.close()
    }
    if (!keepCapture) this.screen?.getTracks().forEach((t) => t.stop())
    this.screen = null
    streams.delete(screenKey(SELF))
    updateCall((c) => {
      c.sharing = false
      c.selfStreamVersion++
    })
  }

  async end(message?: string): Promise<void> {
    if (current === this) current = null
    await this.leave(false)
    if (message) showToast(message)
  }

  /**
   * Leaves this call but keeps its media running and its view open, for the call it moves to. The
   * screen share only carries over when asked: sharing it into a different call needs a choice.
   */
  async handOver(keepScreen: boolean): Promise<CallHandover> {
    const active = useCall.getState().active
    const handover: CallHandover = {
      microphone: this.microphone,
      camera: this.camera,
      blur: this.blur,
      screen: keepScreen ? this.screen : null,
      muted: !!active?.muted,
      expanded: !!active?.expanded,
      poppedOut: !!active?.poppedOut
    }
    this.stopScreenShare(keepScreen)
    this.microphone = null
    this.camera = null
    this.blur = null
    await this.leave(false, true)
    return handover
  }

  async leave(endForEveryone: boolean, handingOver = false): Promise<void> {
    if (this.ended) return
    this.ended = true
    let left!: () => void
    holdPresence(this.accountId, new Promise<void>((resolve) => (left = resolve)))
    try {
      await this.release(endForEveryone, handingOver)
    } finally {
      left()
    }
  }

  private async release(endForEveryone: boolean, handingOver: boolean): Promise<void> {
    for (const t of this.timers) clearTimeout(t)
    for (const id of [...this.offerTimers.keys()]) this.stopOfferRequests(id)
    this.stopScreenShare()
    this.publisher?.close()
    for (const link of this.subscribers.values()) link.close()
    for (const d of this.detectors.values()) d.stop()
    for (const el of this.players.values()) {
      el.pause()
      el.srcObject = null
    }
    for (const t of this.microphone?.getTracks() ?? []) t.stop()
    this.blur?.stop()
    this.camera?.stop()
    streams.clear()
    // When handing over, the next call takes the view over as it is
    if (!handingOver) {
      useCall.setState({ active: null })
      void window.hubbub.calls.setActive(false)
    }

    if (this.joined) await this.api.leaveCall(this.token, endForEveryone).catch(() => undefined)
    await this.signaling?.close().catch(() => undefined)
    if (this.ncSession) await this.api.leaveSession(this.token).catch(() => undefined)
  }
}

let current: CallSession | null = null

/** Starts or joins the call in a conversation. Unsupported calls open in the browser. */
export async function startCall(
  accountId: string,
  token: string,
  /**
   * handover: media and view of the call this one continues. prepared: media and view chosen in the
   * call options before the call; another running call is left then.
   */
  opts: { silent?: boolean; handover?: CallHandover; prepared?: CallHandover } = {}
): Promise<void> {
  const account = useApp.getState().accounts[accountId]
  const room = account?.rooms[token]
  const active = useCall.getState().active
  if (!account || !room || (active?.accountId === accountId && active.token === token)) {
    releaseMedia(opts.prepared)
    return
  }

  const reason = callUnsupportedReason(account.caps, room)
  if (reason) {
    releaseHandover(opts.handover)
    releaseMedia(opts.prepared)
    openInBrowser(account, token, reason)
    return
  }
  if (opts.prepared && current) await leaveCall()
  // Switching from another call keeps the microphone, camera and view, but not a screen share
  const handover =
    opts.handover ?? opts.prepared ?? (current ? await handOverCall(undefined, false) : undefined)
  // Without either, the call shows as the preferences say
  const view = handover ? null : usePrefs.getState().callStartView

  const session = new CallSession(accountId, token, handover)
  current = session
  useCall.setState((s) => {
    s.active = {
      accountId,
      token,
      status: 'connecting',
      joinedAt: Date.now(),
      muted: !!handover?.muted,
      speaking: false,
      listenOnly: false,
      videoOn: false,
      cameraAvailable: false,
      expanded: handover ? handover.expanded : view === 'expanded',
      poppedOut: handover ? handover.poppedOut : view === 'popout',
      sharing: false,
      canShareScreen: false,
      screenPicker: false,
      addPeople: false,
      handRaised: false,
      reactions: [],
      selfStreamVersion: 0,
      participants: {},
      side: null,
      showAllTiles: false,
      moderatorRequests: [],
      moderatorAsk: null,
      captionsOn: false,
      captions: []
    }
    s.incoming = s.incoming.filter((c) => !(c.accountId === accountId && c.token === token))
  })
  try {
    await session.start(!!opts.silent)
  } catch (err) {
    // The handed-over screen capture may not have reached the session yet
    handover?.screen?.getTracks().forEach((t) => t.stop())
    await session.leave(false)
    if (current === session) current = null
    if (err instanceof Cancelled) return
    if (err instanceof CallUnsupported) {
      openInBrowser(account, token, err.message)
      return
    }
    showToast(`Could not join the call: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

export async function leaveCall(endForEveryone = false): Promise<void> {
  const session = current
  current = null
  await session?.leave(endForEveryone)
}

/**
 * Leaves the current call, keeping its media and view for startCall(…, { handover }). `view` is how
 * the call was shown, when that has changed since (opening the next conversation collapses it).
 */
export async function handOverCall(
  view?: Pick<CallHandover, 'expanded' | 'poppedOut'>,
  keepScreen = true
): Promise<CallHandover | undefined> {
  const session = current
  current = null
  const handover = await session?.handOver(keepScreen)
  return handover && { ...handover, ...view }
}

function releaseHandover(handover: CallHandover | undefined): void {
  if (!handover) return
  releaseMedia(handover)
  useCall.setState({ active: null })
  void window.hubbub.calls.setActive(false)
}

/** Stops the microphone, camera and screen capture of media that won't be used. */
export function releaseMedia(media: CallHandover | undefined): void {
  if (!media) return
  media.blur?.stop()
  for (const t of [
    ...(media.microphone?.getTracks() ?? []),
    ...(media.screen?.getTracks() ?? []),
    ...(media.camera ? [media.camera] : [])
  ]) {
    t.stop()
  }
}

export function setMuted(muted: boolean): void {
  current?.setMuted(muted)
}

/** Typing signals through the call's connection, when we are in this conversation's call. */
export function sendTypingInCall(accountId: string, token: string, typing: boolean): boolean {
  if (!current || current.accountId !== accountId || current.token !== token) return false
  current.sendTyping(typing)
  return true
}

export function setHandRaised(state: boolean): void {
  current?.setHandRaised(state)
}

export function sendReaction(emoji: string): void {
  current?.react(emoji)
}

const ASK_TIMEOUT = 60_000

/**
 * Asks the moderators to make us a moderator. Talk has no such request, so it goes to the others'
 * Hubbub over the call connection; when nobody answers within a minute, asking in the chat is offered.
 */
export function askToBecomeModerator(): void {
  if (!current) return
  const at = Date.now()
  updateCall((c) => void (c.moderatorAsk = { state: 'waiting', at }))
  current.askToModerate()
  setTimeout(() => {
    const ask = useCall.getState().active?.moderatorAsk
    if (ask?.state === 'waiting' && ask.at === at)
      updateCall((c) => void (c.moderatorAsk = { state: 'unanswered', at }))
  }, ASK_TIMEOUT)
}

/** Asks in the conversation's chat, mentioning its moderators, for those not using Hubbub */
export async function askModeratorsInChat(): Promise<void> {
  const active = useCall.getState().active
  if (!active) return
  const selfId = useApp.getState().accounts[active.accountId]?.user?.id
  try {
    const members = await talk(active.accountId).participants(active.token)
    const moderators = members.filter(
      (m) =>
        m.actorType === 'users' &&
        m.actorId !== selfId &&
        (m.participantType === 1 || m.participantType === 2)
    )
    const mentions = moderators.map((m) => `@"${m.actorId}"`).join(' ')
    await sendMessage(
      active.accountId,
      active.token,
      `Could you make me a moderator of this conversation? ${mentions}`.trim()
    )
    updateCall((c) => void (c.moderatorAsk = { state: 'asked-in-chat', at: Date.now() }))
  } catch (err) {
    showToast(`The request couldn’t be sent: ${errorText(err)}`, 'error')
  }
}

/** A moderator's answer to someone asking to become a moderator */
export async function answerModeratorRequest(req: ModeratorRequest, grant: boolean): Promise<void> {
  const active = useCall.getState().active
  if (!active) return
  updateCall((c) => void (c.moderatorRequests = c.moderatorRequests.filter((r) => r.userId !== req.userId)))
  if (grant) {
    try {
      const api = talk(active.accountId)
      const member = (await api.participants(active.token)).find(
        (m) => m.actorType === 'users' && m.actorId === req.userId
      )
      if (!member) throw new Error(`${req.name} isn’t in the conversation`)
      await api.promoteModerator(active.token, member.attendeeId)
      showToast(`${req.name} is now a moderator`)
      void getSync(active.accountId)?.refreshRooms()
    } catch (err) {
      showToast(`${req.name} couldn’t be made a moderator: ${errorText(err)}`, 'error')
      return
    }
  }
  current?.answerModeratorRequest(req.sessionId, grant)
}

const REACTION_SHOWN = 4000
let reactionId = 0

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

let captionId = 0
const CAPTION_SHOWN = 8_000

function showCaption(sessionId: string, name: string, text: string, final: boolean): void {
  let id = 0
  updateCall((c) => {
    // A speaker's unfinished sentence is replaced as it grows
    const open = c.captions.find((x) => x.sessionId === sessionId && !x.final)
    if (open) {
      open.text = text
      open.final = final
      id = open.id
    } else {
      id = ++captionId
      c.captions = [...c.captions.slice(-4), { id, sessionId, name, text, final }]
    }
  })
  if (final) {
    setTimeout(
      () => updateCall((c) => void (c.captions = c.captions.filter((x) => x.id !== id))),
      CAPTION_SHOWN
    )
  }
}

/** Turns live captions on or off for us in the running call */
export async function setCaptions(on: boolean): Promise<void> {
  const active = useCall.getState().active
  if (!active) return
  try {
    const api = talk(active.accountId)
    if (on) await api.enableLiveTranscription(active.token)
    else await api.disableLiveTranscription(active.token)
    updateCall((c) => {
      c.captionsOn = on
      if (!on) c.captions = []
    })
  } catch (err) {
    showToast(`Live captions couldn’t be turned ${on ? 'on' : 'off'}: ${errorText(err)}`, 'error')
  }
}

/** Starts (1 video, 2 audio) or stops recording the running call; moderators */
export async function setRecording(kind: 1 | 2 | null): Promise<void> {
  const active = useCall.getState().active
  if (!active) return
  try {
    const api = talk(active.accountId)
    if (kind) await api.startRecording(active.token, kind)
    else await api.stopRecording(active.token)
    void getSync(active.accountId)?.refreshRooms()
  } catch (err) {
    showToast(`The recording couldn’t be ${kind ? 'started' : 'stopped'}: ${errorText(err)}`, 'error')
  }
}

/** Continues the running call in another conversation, as breakout rooms do */
async function switchCallTo(accountId: string, target: string): Promise<void> {
  await getSync(accountId)?.refreshRooms()
  const room = useApp.getState().accounts[accountId]?.rooms[target]
  if (!room) return
  showToast(`Moving to ${room.displayName}`)
  await startCall(accountId, target)
  openRoom(accountId, target)
}

function showReaction(from: string, name: string, emoji: string): void {
  const id = ++reactionId
  updateCall((c) => {
    c.reactions = [...c.reactions.slice(-9), { id, from, name, emoji }]
  })
  setTimeout(
    () => updateCall((c) => void (c.reactions = c.reactions.filter((r) => r.id !== id))),
    REACTION_SHOWN
  )
}

export function setVideo(on: boolean): Promise<void> {
  return current?.setVideo(on) ?? Promise.resolve()
}

/**
 * Starts or joins a call because the user asked to: with the call options first, when those are on
 * and the call happens in Hubbub.
 */
export function requestCall(accountId: string, token: string): Promise<void> {
  const account = useApp.getState().accounts[accountId]
  const room = account?.rooms[token]
  const active = useCall.getState().active
  const inIt = active?.accountId === accountId && active.token === token
  if (!usePrefs.getState().callSetup || !room || inIt || callUnsupportedReason(account.caps, room)) {
    return startCall(accountId, token)
  }
  setApp({ modal: { type: 'call-setup', accountId, token } })
  return Promise.resolve()
}

/** Uses this microphone from now on, in this call and the next ones (null: the system's). */
export function switchMicrophone(deviceId: string | null): Promise<void> {
  usePrefs.getState().set({ microphoneId: deviceId })
  return current?.switchMicrophone() ?? Promise.resolve()
}

/** Uses this camera from now on, in this call and the next ones (null: the system's). */
export function switchCamera(deviceId: string | null): Promise<void> {
  usePrefs.getState().set({ cameraId: deviceId })
  return current?.switchCamera() ?? Promise.resolve()
}

/** Plays calls through this speaker from now on (null: the system's). */
export function switchSpeaker(deviceId: string | null): void {
  usePrefs.getState().set({ speakerId: deviceId })
  current?.switchSpeaker()
}

/** Blurs the background of our camera from now on, in this call and the next ones. */
export function setBackgroundBlur(on: boolean): Promise<void> {
  usePrefs.getState().set({ backgroundBlur: on })
  return current?.updateBlur() ?? Promise.resolve()
}

/**
 * The call view shows these streams (key → simulcast layer for the tile size); all other video is
 * paused to save bandwidth.
 */
export function setVisibleVideos(layers: Record<string, number>): void {
  current?.setVisibleVideos(layers)
}

export function setCallExpanded(expanded: boolean): void {
  updateCall((c) => {
    c.expanded = expanded
    if (expanded) c.poppedOut = false
  })
}

/** Opens the screen picker, or stops sharing. */
export function toggleScreenShare(): void {
  if (useCall.getState().active?.sharing) current?.stopScreenShare()
  else updateCall((c) => void (c.screenPicker = true))
}

export function closeScreenPicker(): void {
  updateCall((c) => void (c.screenPicker = false))
  void window.hubbub.calls.chooseScreen(null)
}

export async function shareScreen(sourceId: string): Promise<void> {
  updateCall((c) => void (c.screenPicker = false))
  await current?.startScreenShare(sourceId)
}

export function setCallPoppedOut(poppedOut: boolean): void {
  updateCall((c) => {
    c.poppedOut = poppedOut
    if (poppedOut) c.expanded = false
  })
}

function openInBrowser(account: AccountState, token: string, reason: string): void {
  void window.hubbub.app.openExternal(`${account.info.serverUrl}/index.php/call/${token}`)
  showToast(`${reason}. The call opened in your browser.`)
}
