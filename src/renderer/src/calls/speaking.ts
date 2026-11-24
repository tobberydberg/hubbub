// Detects whether someone is speaking from the level of an audio stream.

const THRESHOLD_DB = -50
const START_AFTER = 2 // samples above the threshold
const STOP_AFTER = 8 // samples below it (~0.8 s)
const INTERVAL = 100

let context: AudioContext | null = null

function audioContext(): AudioContext {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

export class SpeakingDetector {
  private readonly source: MediaStreamAudioSourceNode
  private readonly analyser: AnalyserNode
  private readonly timer: ReturnType<typeof setInterval>
  private speaking = false
  private above = 0
  private below = 0

  constructor(stream: MediaStream, onChange: (speaking: boolean) => void) {
    const ctx = audioContext()
    this.source = ctx.createMediaStreamSource(stream)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.source.connect(this.analyser)
    const samples = new Float32Array(this.analyser.fftSize)

    this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const v of samples) sum += v * v
      const db = 10 * Math.log10(sum / samples.length || 1e-10)
      if (db > THRESHOLD_DB) {
        this.above++
        this.below = 0
      } else {
        this.below++
        this.above = 0
      }
      const next = this.speaking ? this.below < STOP_AFTER : this.above >= START_AFTER
      if (next !== this.speaking) {
        this.speaking = next
        onChange(next)
      }
    }, INTERVAL)
  }

  stop(): void {
    clearInterval(this.timer)
    this.source.disconnect()
  }
}
