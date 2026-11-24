import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Sparkles, Video, VideoOff, Volume2 } from 'lucide-react'
import type { BackgroundBlur } from '@renderer/calls/blur'
import { startCall } from '@renderer/calls/call'
import {
  deviceLabel,
  openCameraTrack,
  openMicrophoneStream,
  playTestSound,
  useMediaDevices,
  useMicrophoneLevel
} from '@renderer/calls/devices'
import { setApp, useApp, type ModalState } from '@renderer/store/app'
import { usePrefs } from '@renderer/store/prefs'
import { Modal } from '../common/Modal'

// The call options before starting or joining a call: which camera, microphone and speaker, with a
// camera preview, a microphone level and a test sound, whether to start with the camera on or muted,
// and how the call shows. The microphone and camera opened here go on into the call.

const PUBLISH_AUDIO = 32
const PUBLISH_VIDEO = 64

const VIEWS = [
  { value: 'sidebar', label: 'In the sidebar' },
  { value: 'expanded', label: 'In the window' },
  { value: 'popout', label: 'In its own window' }
] as const

const close = (): void => setApp({ modal: null })
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function CallSetupModal({ modal }: { modal: Extract<ModalState, { type: 'call-setup' }> }) {
  const room = useApp((s) => s.accounts[modal.accountId]?.rooms[modal.token])
  const prefs = usePrefs()
  const canAudio = !(room?.permissions && !(room.permissions & PUBLISH_AUDIO))
  const mayVideo = !(room?.permissions && !(room.permissions & PUBLISH_VIDEO))

  const [granted, setGranted] = useState(0)
  const devices = useMediaDevices(granted)
  const canVideo = mayVideo && devices.cameras.length > 0

  const [micOn, setMicOn] = useState(!prefs.startMuted)
  const [camOn, setCamOn] = useState(prefs.startWithCamera)
  const [view, setView] = useState(prefs.callStartView)
  const [microphone, setMicrophone] = useState<MediaStream | null>(null)
  const [camera, setCamera] = useState<MediaStreamTrack | null>(null)
  const [blur, setBlur] = useState<BackgroundBlur | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [camError, setCamError] = useState<string | null>(null)
  /** Set when the media went into the call, so closing doesn't stop it */
  const started = useRef(false)
  const level = useMicrophoneLevel(micOn ? microphone : null)

  // The microphone, reopened when another one is picked
  useEffect(() => {
    if (!canAudio) return
    let stream: MediaStream | null = null
    let cancelled = false
    void (async () => {
      if (!(await window.hubbub.calls.mediaAccess('microphone'))) {
        setMicError('Hubbub may not use the microphone. Allow it in your system settings.')
        return
      }
      try {
        stream = await openMicrophoneStream(prefs.microphoneId)
      } catch (err) {
        if (!cancelled) setMicError(`The microphone could not be started: ${errorText(err)}`)
        return
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop())
      setMicError(null)
      setMicrophone(stream)
      setGranted((n) => n + 1)
    })()
    return () => {
      cancelled = true
      if (stream && !started.current) stream.getTracks().forEach((t) => t.stop())
    }
  }, [canAudio, prefs.microphoneId])

  // The camera while it is on, reopened when another one is picked
  useEffect(() => {
    setCamera(null)
    if (!camOn || !mayVideo) return
    let track: MediaStreamTrack | null = null
    let cancelled = false
    void (async () => {
      if (!(await window.hubbub.calls.mediaAccess('camera'))) {
        setCamError('Hubbub may not use the camera. Allow it in your system settings.')
        return
      }
      try {
        track = await openCameraTrack(prefs.cameraId)
      } catch (err) {
        if (!cancelled) setCamError(`The camera could not be started: ${errorText(err)}`)
        return
      }
      if (cancelled) return track.stop()
      setCamError(null)
      setCamera(track)
      setGranted((n) => n + 1)
    })()
    return () => {
      cancelled = true
      if (track && !started.current) track.stop()
    }
  }, [camOn, mayVideo, prefs.cameraId])

  // The blurred camera, when blur is on
  useEffect(() => {
    setBlur(null)
    if (!camera || !prefs.backgroundBlur) return
    let made: BackgroundBlur | null = null
    let cancelled = false
    void import('@renderer/calls/blur')
      .then(({ BackgroundBlur }) => BackgroundBlur.create(camera))
      .then((b) => {
        if (cancelled) return b.stop()
        made = b
        setBlur(b)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (made && !started.current) made.stop()
    }
  }, [camera, prefs.backgroundBlur])

  const preview = blur?.track ?? camera
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = preview ? new MediaStream([preview]) : null
    if (preview) void el.play().catch(() => undefined)
  }, [preview])

  const start = (): void => {
    started.current = true
    const withCamera = camOn && !!camera
    // What isn't going into the call stops here
    if (!withCamera) {
      blur?.stop()
      camera?.stop()
    }
    prefs.set({ startMuted: !micOn, startWithCamera: camOn, callStartView: view })
    close()
    void startCall(modal.accountId, modal.token, {
      prepared: {
        microphone: canAudio ? microphone : null,
        camera: withCamera ? camera : null,
        blur: withCamera ? blur : null,
        screen: null,
        muted: !micOn,
        expanded: view === 'expanded',
        poppedOut: view === 'popout'
      }
    })
  }

  const select = (
    value: string | null,
    list: MediaDeviceInfo[],
    onChange: (id: string | null) => void,
    disabled = false
  ): React.ReactNode => (
    <select
      className="input"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">System default</option>
      {list.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId}>
          {deviceLabel(d, i)}
        </option>
      ))}
    </select>
  )

  const joining = !!room?.hasCall
  return (
    <Modal
      title={`${joining ? 'Join the call in' : 'Start a call in'} ${room?.displayName ?? 'this conversation'}`}
      onClose={close}
      size="large"
      footer={
        <>
          <label className="cs-again">
            <input
              type="checkbox"
              checked={prefs.callSetup}
              onChange={(e) => prefs.set({ callSetup: e.target.checked })}
            />
            Show these options before every call
          </label>
          <button className="btn btn-tertiary" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" autoFocus onClick={start}>
            {joining ? 'Join call' : 'Start call'}
          </button>
        </>
      }
    >
      <div className="cs">
        <div className="cs-preview">
          {preview ? (
            <video ref={videoRef} className="mirror" autoPlay playsInline muted />
          ) : (
            <div className="cs-nocam">
              <VideoOff size={32} />
              <span>
                {!mayVideo
                  ? 'You can’t use your camera in this conversation'
                  : !canVideo
                    ? 'No camera found'
                    : (camError ?? (camOn ? 'Starting the camera…' : 'Your camera is off'))}
              </span>
            </div>
          )}
          <div className="cs-preview-controls">
            <button
              className={`cv-btn${micOn && canAudio ? '' : ' off'}`}
              disabled={!canAudio}
              title={micOn ? 'Start muted' : 'Start with the microphone on'}
              onClick={() => setMicOn(!micOn)}
            >
              {micOn && canAudio ? <Mic size={20} /> : <MicOff size={20} />}
            </button>
            <button
              className={`cv-btn${camOn && canVideo ? '' : ' off'}`}
              disabled={!canVideo}
              title={camOn ? 'Start with the camera off' : 'Start with the camera on'}
              onClick={() => setCamOn(!camOn)}
            >
              {camOn && canVideo ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
            <button
              className={`cv-btn${prefs.backgroundBlur ? ' active' : ''}`}
              disabled={!canVideo}
              title={prefs.backgroundBlur ? 'Stop blurring your background' : 'Blur your background'}
              onClick={() => prefs.set({ backgroundBlur: !prefs.backgroundBlur })}
            >
              <Sparkles size={20} />
            </button>
          </div>
        </div>

        <div className="cs-settings">
          <label className="field-label">Camera</label>
          {select(prefs.cameraId, devices.cameras, (id) => prefs.set({ cameraId: id }), !canVideo)}

          <label className="field-label">Microphone</label>
          {select(
            prefs.microphoneId,
            devices.microphones,
            (id) => prefs.set({ microphoneId: id }),
            !canAudio
          )}
          <div className="cs-meter" title="How loud you are">
            <div style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          {(micError || !canAudio) && (
            <p className="help">{micError ?? 'You can only listen in this conversation.'}</p>
          )}

          <label className="field-label">Speaker</label>
          <div className="cs-row">
            {select(prefs.speakerId, devices.speakers, (id) => prefs.set({ speakerId: id }))}
            <button className="btn btn-tertiary small" onClick={() => void playTestSound(prefs.speakerId)}>
              <Volume2 size={14} /> Test
            </button>
          </div>

          <label className="field-label">Show the call</label>
          <div className="cs-views" role="radiogroup">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                role="radio"
                aria-checked={view === v.value}
                className={view === v.value ? 'selected' : ''}
                onClick={() => setView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
