import type { SignalingSettings } from '@shared/talk-types'

// Client for the Talk High-Performance Backend (nextcloud-spreed-signaling), see
// https://nextcloud-spreed-signaling.readthedocs.io/ and Talk's docs/signaling-messages.md.

/** A Talk signaling message between call participants (offer, answer, candidate, mute, …) */
export interface SignalData {
  type: string
  to?: string
  from?: string
  sid?: string
  roomType?: 'video' | 'screen'
  payload?: unknown
  [key: string]: unknown
}

/** A participant entry of a "participants update" event */
export interface CallUpdate {
  sessionId: string
  inCall: number
  userId?: string
  actorType?: string
  actorId?: string
  displayName?: string
  internal?: boolean
  virtual?: boolean
}

export interface JoinedSession {
  sessionid: string
  userid?: string
  user?: { displayname?: string }
  roomsessionid?: string
  federated?: boolean
}

export interface SignalingHandlers {
  message(from: string, data: SignalData): void
  join(sessions: JoinedSession[]): void
  leave(sessionIds: string[]): void
  /** Call state of participants; `users` is a full snapshot, `changed` only the differences */
  participants(update: { changed?: CallUpdate[]; users?: CallUpdate[]; all?: boolean; incall?: number }): void
  /** The connection was lost and the session could not be resumed: rejoin and renegotiate */
  reset(): void
  connection(state: 'connected' | 'reconnecting'): void
  /** The server ended our session (kicked, conversation deleted, …) */
  closed(reason: string): void
}

interface ServerMessage {
  id?: string
  type: string
  [key: string]: unknown
}

const MAX_BACKOFF = 16_000

export class SignalingError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export class HpbSignaling {
  sessionId = ''
  features: string[] = []
  private ws: WebSocket | null = null
  private resumeId = ''
  private version = '2.0'
  private nextId = 0
  private pending = new Map<string, { resolve: (m: ServerMessage) => void; reject: (e: Error) => void }>()
  private closing = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = 1000
  private room: { roomid: string; sessionid: string } | null = null

  constructor(
    private readonly serverUrl: string,
    private settings: SignalingSettings,
    private readonly refreshSettings: () => Promise<SignalingSettings>,
    private readonly on: SignalingHandlers
  ) {}

  /** Connects and authenticates; resolves with our signaling session id. */
  async connect(): Promise<string> {
    await this.open()
    await this.hello()
    return this.sessionId
  }

  async joinRoom(roomid: string, nextcloudSessionId: string): Promise<void> {
    this.room = { roomid, sessionid: nextcloudSessionId }
    await this.request('room', this.room)
  }

  sendToSession(sessionId: string, data: SignalData): void {
    this.send('message', { recipient: { type: 'session', sessionid: sessionId }, data })
  }

  sendToRoom(data: SignalData): void {
    this.send('message', { recipient: { type: 'room' }, data })
  }

  /** Leaves the room and releases the session on the server. */
  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.room) this.send('room', { roomid: '', sessionid: '' })
      await this.request('bye', {}).catch(() => undefined)
    }
    this.ws?.close()
    this.ws = null
    this.failPending(new Error('closed'))
  }

  private url(): string {
    const base = this.settings.server.replace(/\/+$/, '').replace(/^http/i, 'ws')
    return base.endsWith('/spreed') ? base : `${base}/spreed`
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url())
      this.ws = ws
      ws.onopen = () => resolve()
      ws.onerror = () =>
        reject(new SignalingError('connection_failed', 'Could not reach the signaling server'))
      ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMessage)
      ws.onclose = () => {
        if (this.ws !== ws) return
        this.ws = null
        this.failPending(new SignalingError('connection_lost', 'Connection to the signaling server lost'))
        if (!this.closing && this.sessionId) this.scheduleReconnect()
      }
    })
  }

  private async hello(): Promise<void> {
    const params = this.settings.helloAuthParams
    const auth = { url: `${this.serverUrl}/ocs/v2.php/apps/spreed/api/v3/signaling/backend` }
    const body = params['2.0']
      ? { version: '2.0', auth: { ...auth, params: params['2.0'] } }
      : { version: '1.0', auth: { ...auth, params: params['1.0'] } }
    this.version = body.version
    const res = await this.request('hello', { ...body, features: [] })
    this.accept(res)
  }

  private accept(res: ServerMessage): void {
    const hello = res.hello as { sessionid: string; resumeid?: string; server?: { features?: string[] } }
    this.sessionId = hello.sessionid
    if (hello.resumeid) this.resumeId = hello.resumeid
    if (hello.server?.features?.length) this.features = hello.server.features
  }

  private scheduleReconnect(): void {
    this.on.connection('reconnecting')
    this.retryTimer = setTimeout(() => void this.reconnect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF)
  }

  private async reconnect(): Promise<void> {
    try {
      await this.open()
      try {
        this.accept(await this.request('hello', { version: this.version, resumeid: this.resumeId }))
        this.backoff = 1000
        this.on.connection('connected')
        return
      } catch (err) {
        if (!(err instanceof SignalingError) || err.code !== 'no_such_session') throw err
      }
      // The session expired while we were away: start over with fresh credentials
      this.settings = await this.refreshSettings()
      await this.hello()
      if (this.room) await this.request('room', this.room)
      this.backoff = 1000
      this.on.connection('connected')
      this.on.reset()
    } catch {
      if (!this.closing) this.scheduleReconnect()
    }
  }

  private send(type: string, body: unknown, id?: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ ...(id ? { id } : {}), type, [type]: body }))
  }

  private request(type: string, body: unknown): Promise<ServerMessage> {
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new SignalingError('connection_lost', 'Not connected to the signaling server'))
        return
      }
      this.pending.set(id, { resolve, reject })
      this.send(type, body, id)
    })
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
  }

  private receive(msg: ServerMessage): void {
    const waiting = msg.id ? this.pending.get(msg.id) : undefined
    if (waiting) {
      this.pending.delete(msg.id!)
      if (msg.type === 'error') {
        const e = msg.error as { code: string; message: string }
        // Joining a room we are already in is fine (e.g. after a reconnect)
        if (e.code === 'already_joined') waiting.resolve(msg)
        else waiting.reject(new SignalingError(e.code, e.message))
      } else {
        waiting.resolve(msg)
      }
      return
    }

    switch (msg.type) {
      case 'message': {
        const m = msg.message as { sender: { sessionid: string }; data: SignalData }
        this.on.message(m.sender.sessionid, m.data)
        break
      }
      case 'control': {
        const c = msg.control as { sender: { sessionid: string }; data: Record<string, unknown> }
        this.on.message(c.sender.sessionid, { type: 'control', payload: c.data })
        break
      }
      case 'event':
        this.event(msg.event as { target: string; type: string; [key: string]: unknown })
        break
      case 'room': {
        // Unsolicited: the server moved us out of the room
        const room = msg.room as { roomid: string }
        if (this.room && !room.roomid) this.on.closed('removed')
        break
      }
      case 'bye':
        this.on.closed('bye')
        break
    }
  }

  private event(ev: { target: string; type: string; [key: string]: unknown }): void {
    if (ev.target === 'room' && ev.type === 'join') this.on.join(ev.join as JoinedSession[])
    else if (ev.target === 'room' && ev.type === 'leave') this.on.leave(ev.leave as string[])
    else if (ev.target === 'participants' && ev.type === 'update') {
      this.on.participants(ev.update as Parameters<SignalingHandlers['participants']>[0])
    } else if (ev.target === 'roomlist' && ev.type === 'disinvite') {
      this.on.closed('disinvited')
    }
  }
}
