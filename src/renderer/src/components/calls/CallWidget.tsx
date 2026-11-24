import {
  AppWindow,
  ExternalLink,
  Maximize2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  UserPlus,
  Video,
  VideoOff
} from 'lucide-react'
import {
  leaveCall,
  setCallExpanded,
  setCallPoppedOut,
  setMuted,
  setVideo,
  toggleScreenShare
} from '@renderer/calls/call'
import { openRoom, selectAccount } from '@renderer/sync/actions'
import { useApp } from '@renderer/store/app'
import { updateCall, useCall, type ActiveCall } from '@renderer/store/call'
import { Avatar } from '../common/Avatar'
import { focusCallPopout } from './CallPopout'
import { useElapsed } from './useElapsed'
import { roomTitle } from '@renderer/lib/rooms'
import { DeviceMenu } from './DeviceMenu'

// Mattermost-style call widget, docked at the bottom of the sidebar while in a call.

const MAX_AVATARS = 6

export function CallWidget() {
  const call = useCall((s) => s.active)
  if (!call || call.expanded) return null
  return <Widget call={call} />
}

function Widget({ call }: { call: ActiveCall }) {
  const account = useApp((s) => s.accounts[call.accountId])
  const room = account?.rooms[call.token]
  const elapsed = useElapsed(call.joinedAt)
  const others = Object.values(call.participants)
  const self = account?.user

  const status =
    call.status === 'connecting'
      ? 'Connecting…'
      : call.status === 'reconnecting'
        ? 'Reconnecting…'
        : `${elapsed} · ${others.length + 1} in call`

  const shown = others.slice(0, MAX_AVATARS - 1)
  const hidden = others.length - shown.length
  const sharer = others.filter((p) => p.screen).sort((a, b) => b.screenSince - a.screenSince)[0]
  const showCall = (): void => (call.poppedOut ? focusCallPopout() : setCallExpanded(true))

  return (
    <div className="call-widget">
      <div className="cw-top">
        <button
          className="cw-head"
          title="Go to the conversation"
          onClick={() => {
            selectAccount(call.accountId)
            openRoom(call.accountId, call.token)
          }}
        >
          <span className={`cw-dot ${call.status}`} />
          <span className="cw-text">
            <span className="cw-title">{room ? roomTitle(room, account?.user?.displayname) : 'Call'}</span>
            <span className="cw-sub">{status}</span>
          </span>
        </button>
        <button
          className="cw-tool"
          title="Add people to the call"
          onClick={() => {
            // With the call popped out, the dialog opens there
            if (call.poppedOut) focusCallPopout()
            updateCall((c) => void (c.addPeople = true))
          }}
        >
          <UserPlus size={16} />
        </button>
        {call.poppedOut ? (
          <button className="cw-tool" title="Show the call window" onClick={focusCallPopout}>
            <AppWindow size={16} />
          </button>
        ) : (
          <>
            <button className="cw-tool" title="Open the call view" onClick={() => setCallExpanded(true)}>
              <Maximize2 size={16} />
            </button>
            <button
              className="cw-tool"
              title="Pop out the call into its own window"
              onClick={() => setCallPoppedOut(true)}
            >
              <ExternalLink size={16} />
            </button>
          </>
        )}
      </div>

      {sharer && (
        <button className="cw-sharing" onClick={showCall}>
          <MonitorUp size={14} />
          <span>{sharer.name} is sharing their screen</span>
        </button>
      )}

      <div className="cw-people">
        {self && (
          <Person
            accountId={call.accountId}
            name={`${self.displayname} (you)`}
            userId={self.id}
            muted={call.muted || call.listenOnly}
            speaking={call.speaking && !call.muted}
            hand={call.handRaised}
          />
        )}
        {shown.map((p) => (
          <Person
            key={p.sessionId}
            accountId={call.accountId}
            name={p.name}
            userId={p.userId}
            muted={p.muted}
            speaking={p.speaking}
            hand={p.handRaisedAt > 0}
            connecting={!p.connected && !p.muted}
          />
        ))}
        {hidden > 0 && <span className="cw-more">+{hidden}</span>}
      </div>

      <div className="cw-actions">
        <span className="cw-split">
          <button
            className={`cw-btn${call.muted || call.listenOnly ? ' off' : ''}`}
            disabled={call.listenOnly}
            title={call.listenOnly ? 'No microphone' : call.muted ? 'Unmute' : 'Mute'}
            onClick={() => setMuted(!call.muted)}
          >
            {call.muted || call.listenOnly ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <DeviceMenu kind="audio" variant="cw" />
        </span>
        <span className="cw-split">
          <button
            className={`cw-btn${call.videoOn ? '' : ' off'}`}
            disabled={!call.cameraAvailable}
            title={!call.cameraAvailable ? 'No camera' : call.videoOn ? 'Turn camera off' : 'Turn camera on'}
            onClick={() => void setVideo(!call.videoOn)}
          >
            {call.videoOn ? <Video size={18} /> : <VideoOff size={18} />}
          </button>
          <DeviceMenu kind="video" variant="cw" disabled={!call.cameraAvailable} />
        </span>
        <button
          className={`cw-btn${call.sharing ? ' active' : ''}`}
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
          {call.sharing ? <MonitorOff size={18} /> : <MonitorUp size={18} />}
        </button>
        <button className="cw-btn leave" title="Leave call" onClick={() => void leaveCall()}>
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  )
}

function Person(props: {
  accountId: string
  name: string
  userId?: string
  muted: boolean
  speaking: boolean
  hand?: boolean
  connecting?: boolean
}) {
  const label = [
    props.name,
    props.hand ? 'hand raised' : '',
    props.muted ? 'muted' : '',
    props.connecting ? 'connecting' : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span
      className={`cw-person${props.speaking ? ' speaking' : ''}${props.connecting ? ' connecting' : ''}`}
      title={label}
    >
      <Avatar accountId={props.accountId} name={props.name} userId={props.userId} size={28} />
      {props.hand && <span className="cw-hand">✋</span>}
      {props.muted && (
        <span className="cw-muted">
          <MicOff size={10} />
        </span>
      )}
    </span>
  )
}
