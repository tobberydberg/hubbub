import { useEffect, useState } from 'react'

// Microphones, speakers and cameras: listing them, opening them the way calls use them, and testing
// them before a call (a level meter for the microphone, a sound for the speaker).

export interface MediaDevices {
  microphones: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
  /** Names are only known once the app may use the microphone or camera */
  unnamed: boolean
}

function sort(devices: MediaDeviceInfo[]): MediaDevices {
  // "default" duplicates one of the others; "System default" stands for it
  const audio = (kind: MediaDeviceKind): MediaDeviceInfo[] =>
    devices.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
  return {
    microphones: audio('audioinput'),
    speakers: audio('audiooutput'),
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    unnamed: devices.some((d) => !d.label)
  }
}

/** The devices, kept up to date as they come and go. `refresh` changes after access is granted. */
export function useMediaDevices(refresh: unknown = null): MediaDevices {
  const [devices, setDevices] = useState<MediaDevices>(() => sort([]))
  useEffect(() => {
    let alive = true
    const load = (): void =>
      void navigator.mediaDevices.enumerateDevices().then((list) => alive && setDevices(sort(list)))
    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [refresh])
  return devices
}

export const deviceLabel = (d: MediaDeviceInfo, i: number): string => d.label || `Device ${i + 1}`

const MICROPHONE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

/**
 * Opens the chosen device, or the system's when it's gone. Chromium only honours an exact deviceId
 * (an "ideal" one is ignored for microphones), so it is asked for exactly first.
 */
async function open(
  kind: 'audio' | 'video',
  constraints: MediaTrackConstraints,
  deviceId: string | null
): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        [kind]: { ...constraints, deviceId: { exact: deviceId } }
      })
    } catch (err) {
      if (!(err instanceof Error) || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) {
        throw err
      }
    }
  }
  return navigator.mediaDevices.getUserMedia({ [kind]: constraints })
}

/** The microphone as calls use it (echo cancellation and noise suppression on). Throws if it fails. */
export function openMicrophoneStream(deviceId: string | null): Promise<MediaStream> {
  return open('audio', MICROPHONE, deviceId)
}

const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }

/** The camera as calls use it (up to 720p at 30 fps). Throws if it fails. */
export async function openCameraTrack(deviceId: string | null): Promise<MediaStreamTrack> {
  const stream = await open('video', CAMERA, deviceId)
  const track = stream.getVideoTracks()[0]
  if (!track) throw new Error('No camera')
  return track
}

/** How loud the microphone is, 0–1, updated while the stream lives. */
export function useMicrophoneLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!stream?.getAudioTracks().length) {
      setLevel(0)
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    let frame = 0
    const tick = (): void => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += s * s
      // RMS on a rough log scale, so speech fills most of the bar
      const rms = Math.sqrt(sum / samples.length)
      setLevel(Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-8) + 60) / 50)))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(frame)
      void ctx.close()
    }
  }, [stream])
  return level
}

/** A short two-note chime on the given speaker (null: the system's). */
export async function playTestSound(sinkId: string | null): Promise<void> {
  const ctx = new AudioContext()
  const out = ctx.createMediaStreamDestination()
  const now = ctx.currentTime
  for (const [i, freq] of [660, 880].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    const start = now + 0.05 + i * 0.35
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.3, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6)
    osc.connect(gain).connect(out)
    osc.start(start)
    osc.stop(start + 0.65)
  }
  const el = new Audio()
  el.srcObject = out.stream
  if (sinkId) await el.setSinkId(sinkId).catch(() => undefined)
  await el.play().catch(() => undefined)
  setTimeout(() => {
    el.pause()
    el.srcObject = null
    void ctx.close()
  }, 1300)
}
