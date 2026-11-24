import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  Hand,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PanelLeftOpen,
  PhoneOff,
  SmilePlus,
  Sparkles,
  SquareUser,
  UserPlus,
  Video,
  VideoOff
} from 'lucide-react'
import {
  callStream,
  layerForWidth,
  leaveCall,
  screenKey,
  sendReaction,
  setBackgroundBlur,
  setCallExpanded,
  setHandRaised,
  setCallPoppedOut,
  setMuted,
  setVideo,
  setVisibleVideos,
  toggleScreenShare
} from '@renderer/calls/call'
import { gridShape, pickTiles } from '@renderer/calls/layout'
import { usePrefs } from '@renderer/store/prefs'
import { openRoom, selectAccount } from '@renderer/sync/actions'
import { hasFeature, useApp } from '@renderer/store/app'
import { updateCall, useCall, type ActiveCall } from '@renderer/store/call'
import { Avatar } from '../common/Avatar'
import { AddPeople } from './AddPeople'
import { ScreenPicker } from './ScreenPicker'
import { useElapsed } from './useElapsed'
import { roomTitle } from '@renderer/lib/rooms'

// The expanded call: a grid of video tiles in place of the conversation, Mattermost-style, or in a
// window of its own (popout). A shared screen takes the stage, with the people in a row below it.

const MAX_TILES = 16
const MAX_STRIP_TILES = 8
/** Width of the tiles in the row below a stage (see .cv-strip in app.css) */
const STRIP_TILE_WIDTH = 192
const GAP = 8

interface Tile {
  id: string
  self?: boolean
  name: string
  userId?: string
  muted: boolean
  videoOn: boolean
  speaking: boolean
  lastSpokeAt: number
  connecting: boolean
  handRaised: boolean
  streamVersion: number
}

interface Presentation {
  key: string
  name: string
  self: boolean
  streamVersion: number
}

export function CallView({ popout = false }: { popout?: boolean }) {
  const call = useCall((s) => s.active)
  if (!call) return null
  return <View call={call} popout={popout} />
}

function View({ call, popout }: { call: ActiveCall; popout: boolean }) {
  const account = useApp((s) => s.accounts[call.accountId])
  const room = account?.rooms[call.token]
  const self = account?.user
  const elapsed = useElapsed(call.joinedAt)

  const tiles = useMemo<Tile[]>(() => {
    const others = Object.values(call.participants)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.sessionId,
        name: p.name,
        userId: p.userId,
        muted: p.muted,
        videoOn: p.videoOn,
        speaking: p.speaking,
        lastSpokeAt: p.lastSpokeAt,
        connecting: !p.connected,
        handRaised: p.handRaisedAt > 0,
        streamVersion: p.streamVersion
      }))
    const me: Tile = {
      id: 'self',
      self: true,
      name: self ? `${self.displayname} (you)` : 'You',
      userId: self?.id,
      muted: call.muted || call.listenOnly,
      videoOn: call.videoOn,
      speaking: call.speaking && !call.muted,
      lastSpokeAt: 0,
      connecting: false,
      handRaised: call.handRaised,
      streamVersion: call.selfStreamVersion
    }
    return [me, ...others]
  }, [call, self])

  // The most recently started screen of someone else; our own only when nobody else shares
  const presentation = useMemo<Presentation | null>(() => {
    const sharer = Object.values(call.participants)
      .filter((p) => p.screen)
      .sort((a, b) => b.screenSince - a.screenSince)[0]
    if (sharer) {
      return {
        key: screenKey(sharer.sessionId),
        name: sharer.name,
        self: false,
        streamVersion: sharer.streamVersion
      }
    }
    if (call.sharing)
      return { key: screenKey('self'), name: 'You', self: true, streamVersion: call.selfStreamVersion }
    return null
  }, [call])

  // Speaker view: whoever is talking or talked last (not us), else whoever joined first
  const layout = usePrefs((s) => s.callLayout)
  const blur = usePrefs((s) => s.backgroundBlur)
  const speaker = useMemo<Tile | null>(() => {
    if (presentation || layout !== 'speaker') return null
    const others = tiles.filter((t) => !t.self)
    return (
      [...others].sort(
        (a, b) => Number(b.speaking) - Number(a.speaking) || b.lastSpokeAt - a.lastSpokeAt
      )[0] ?? null
    )
  }, [presentation, layout, tiles])

  const staged = presentation !== null || speaker !== null
  const stripTiles = speaker ? tiles.filter((t) => t.id !== speaker.id) : tiles
  const { shown, hidden } = pickTiles(stripTiles, staged ? MAX_STRIP_TILES : MAX_TILES)
  const count = shown.length + (hidden ? 1 : 0)

  const presenting = staged
  const gridRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    // The observer of the element's own window, which may be the popped-out one
    const Observer = el.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver
    const observer = new Observer(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [presenting])
  const { cols, tileWidth } = gridShape(count, size.width, size.height, GAP)

  // Only download the video that is on screen, in the quality its tile needs
  const layers: Record<string, number> = {}
  for (const t of shown) {
    if (!t.self && t.videoOn) layers[t.id] = layerForWidth(staged ? STRIP_TILE_WIDTH : tileWidth)
  }
  if (speaker?.videoOn) layers[speaker.id] = 2
  if (presentation && !presentation.self) layers[presentation.key] = 2
  const visible = JSON.stringify(layers)
  useEffect(() => {
    setVisibleVideos(JSON.parse(visible) as Record<string, number>)
  }, [visible])
  useEffect(() => () => setVisibleVideos({}), [])

  const status =
    call.status === 'connecting' ? 'Connecting…' : call.status === 'reconnecting' ? 'Reconnecting…' : elapsed
  const callConfig = account?.caps?.config.call as { 'supported-reactions'?: string[] } | undefined
  const reactions = callConfig?.['supported-reactions'] ?? []

  const people = (
    <>
      {shown.map((t) => (
        <TileView key={t.id} tile={t} accountId={call.accountId} />
      ))}
      {hidden > 0 && (
        <div className="cv-tile cv-more">
          <span>+{hidden}</span>
          <small>more in the call</small>
        </div>
      )}
    </>
  )

  return (
    <main className="call-view">
      <div className="cv-header">
        <span className={`cw-dot ${call.status}`} />
        <span className="cv-title">{room ? roomTitle(room, account?.user?.displayname) : 'Call'}</span>
        <span className="cv-sub">
          {status} · {tiles.length} in call
        </span>
        <span className="cv-layout" role="group" aria-label="Layout">
          <button
            className={layout === 'grid' ? 'active' : ''}
            title="Grid: everyone the same size"
            onClick={() => usePrefs.getState().set({ callLayout: 'grid' })}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            className={layout === 'speaker' ? 'active' : ''}
            title="Speaker: whoever is talking, large"
            onClick={() => usePrefs.getState().set({ callLayout: 'speaker' })}
          >
            <SquareUser size={16} />
          </button>
        </span>
        {popout ? (
          <button
            className="cv-back"
            title="Show the call in the main window again"
            onClick={() => {
              setCallExpanded(true)
              void window.hubbub.app.focusWindow()
            }}
          >
            <PanelLeftOpen size={16} />
            Back to main window
          </button>
        ) : (
          <>
            <button
              className="cv-back"
              title="Show the call in a separate window, and keep chatting here"
              onClick={() => setCallPoppedOut(true)}
            >
              <ExternalLink size={16} />
              Pop out
            </button>
            <button
              className="cv-back"
              onClick={() => {
                setCallExpanded(false)
                selectAccount(call.accountId)
                openRoom(call.accountId, call.token)
              }}
            >
              <MessageSquare size={16} />
              Back to chat
            </button>
          </>
        )}
      </div>

      {presentation ? (
        <>
          <div className="cv-stage">
            <ScreenStage presentation={presentation} />
          </div>
          <div className="cv-strip">{people}</div>
        </>
      ) : speaker ? (
        <>
          <div className="cv-stage">
            <TileView tile={speaker} accountId={call.accountId} stage />
          </div>
          <div className="cv-strip">{people}</div>
        </>
      ) : (
        <div
          className="cv-grid"
          ref={gridRef}
          style={{ gridTemplateColumns: `repeat(${cols}, ${tileWidth}px)`, gap: GAP }}
        >
          {people}
        </div>
      )}

      <div className="cv-controls">
        <button
          className={`cv-btn${call.muted || call.listenOnly ? ' off' : ''}`}
          disabled={call.listenOnly}
          title={call.listenOnly ? 'No microphone' : call.muted ? 'Unmute' : 'Mute'}
          onClick={() => setMuted(!call.muted)}
        >
          {call.muted || call.listenOnly ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        <button
          className={`cv-btn${call.videoOn ? '' : ' off'}`}
          disabled={!call.cameraAvailable}
          title={!call.cameraAvailable ? 'No camera' : call.videoOn ? 'Turn camera off' : 'Turn camera on'}
          onClick={() => void setVideo(!call.videoOn)}
        >
          {call.videoOn ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        {call.cameraAvailable && (
          <button
            className={`cv-btn${blur ? ' active' : ''}`}
            title={blur ? 'Stop blurring your background' : 'Blur your background'}
            onClick={() => void setBackgroundBlur(!blur)}
          >
            <Sparkles size={20} />
          </button>
        )}
        <button
          className={`cv-btn${call.sharing ? ' active' : ''}`}
          disabled={!call.canShareScreen}
          title={
            !call.canShareScreen
              ? 'You may not share your screen in this conversation'
              : call.sharing
                ? 'Stop sharing'
                : 'Share your screen'
          }
          onClick={toggleScreenShare}
        >
          {call.sharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
        </button>
        {hasFeature(account, 'raise-hand') && (
          <button
            className={`cv-btn${call.handRaised ? ' hand' : ''}`}
            title={call.handRaised ? 'Lower hand' : 'Raise hand'}
            onClick={() => setHandRaised(!call.handRaised)}
          >
            <Hand size={20} />
          </button>
        )}
        {reactions.length > 0 && <ReactionButton reactions={reactions} />}
        <button
          className="cv-btn"
          title="Add people to the call"
          onClick={() => updateCall((c) => void (c.addPeople = true))}
        >
          <UserPlus size={20} />
        </button>
        <button className="cv-btn leave" title="Leave call" onClick={() => void leaveCall()}>
          <PhoneOff size={20} />
          Leave
        </button>
      </div>

      <div className="cv-reactions" aria-live="polite">
        {call.reactions.map((r) => (
          <span key={r.id} className="cv-reaction">
            <span className="cv-reaction-emoji">{r.emoji}</span>
            {r.name}
          </span>
        ))}
      </div>

      {popout && call.screenPicker && <ScreenPicker />}
      {popout && call.addPeople && <AddPeople />}
    </main>
  )
}

function ScreenStage({ presentation }: { presentation: Presentation }) {
  const stream = callStream(presentation.key)
  return (
    <div className="cv-screen">
      {stream?.getVideoTracks().length ? (
        <VideoStream stream={stream} version={presentation.streamVersion} contain />
      ) : (
        <span className="cv-screen-wait">Loading the shared screen…</span>
      )}
      {presentation.self ? (
        <span className="cv-screen-label self">
          <MonitorUp size={14} /> You are sharing your screen
          <button onClick={toggleScreenShare}>Stop sharing</button>
        </span>
      ) : (
        <span className="cv-screen-label">
          <MonitorUp size={14} /> {presentation.name} is sharing their screen
        </span>
      )}
    </div>
  )
}

function TileView({ tile, accountId, stage }: { tile: Tile; accountId: string; stage?: boolean }) {
  // Looked up again whenever streamVersion changes
  const stream = callStream(tile.id)
  const hasVideo = tile.videoOn && !!stream?.getVideoTracks().length
  const className = [
    'cv-tile',
    stage ? 'stage' : '',
    tile.speaking ? 'speaking' : '',
    tile.connecting ? 'connecting' : '',
    tile.handRaised ? 'hand' : ''
  ]
  return (
    <div className={className.filter(Boolean).join(' ')}>
      {hasVideo ? (
        <VideoStream stream={stream!} version={tile.streamVersion} mirror={tile.self} contain={stage} />
      ) : (
        <Avatar accountId={accountId} name={tile.name} userId={tile.userId} size={stage ? 128 : 96} />
      )}
      {tile.handRaised && (
        <span className="cv-hand" title="Hand raised">
          ✋
        </span>
      )}
      <span className="cv-name">
        {tile.muted && <MicOff size={14} />}
        {tile.name}
      </span>
    </div>
  )
}

function VideoStream(props: { stream: MediaStream; version: number; mirror?: boolean; contain?: boolean }) {
  const { stream, version } = props
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    void el.play().catch(() => undefined)
  }, [stream, version])
  const className = [props.mirror ? 'mirror' : '', props.contain ? 'contain' : ''].filter(Boolean).join(' ')
  // Sound plays through the call's audio elements, so the video stays muted
  return <video ref={ref} className={className || undefined} autoPlay playsInline muted />
}

function ReactionButton({ reactions }: { reactions: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="cv-react">
      <button
        className={`cv-btn${open ? ' active' : ''}`}
        title="Send a reaction"
        onClick={() => setOpen(!open)}
      >
        <SmilePlus size={20} />
      </button>
      {open && (
        <span className="cv-react-menu" onMouseLeave={() => setOpen(false)}>
          {reactions.map((emoji) => (
            <button key={emoji} onClick={() => sendReaction(emoji)}>
              {emoji}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
