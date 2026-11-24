// Background blur for our camera. A person segmentation model (MediaPipe's selfie segmenter, run
// locally in WebAssembly) finds us in every camera frame, and the frame goes out with everything
// else blurred. Frames flow through MediaStreamTrackProcessor/Generator, which keep going while the
// window is hidden, unlike requestAnimationFrame.

import { ImageSegmenter } from '@mediapipe/tasks-vision'
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import modelUrl from '../assets/selfie_segmenter_landscape.tflite?url'

// Chromium's insertable streams for raw video frames, not in TypeScript's DOM types yet
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number })
  readonly readable: ReadableStream<VideoFrame>
}
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(init: { kind: 'video' })
  readonly writable: WritableStream<VideoFrame>
}

/** How far the background is scaled down before blurring: cheaper, and blurrier when scaled back up */
const BACKGROUND_SCALE = 4
const BACKGROUND_BLUR = 6
/** Share of the previous mask kept in the new one, against flicker at the edges */
const MASK_SMOOTHING = 0.35

let segmenter: Promise<ImageSegmenter> | null = null

async function createSegmenter(delegate: 'GPU' | 'CPU'): Promise<ImageSegmenter> {
  return ImageSegmenter.createFromOptions(
    { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
    {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true
    }
  )
}

/** One segmenter for the app's lifetime: loading it takes a moment, running it doesn't. */
function loadSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= createSegmenter('GPU')
    .catch(() => createSegmenter('CPU'))
    .catch((err) => {
      segmenter = null
      throw err
    })
  return segmenter
}

export function blurSupported(): boolean {
  return 'MediaStreamTrackProcessor' in window && 'MediaStreamTrackGenerator' in window
}

let lastTimestamp = 0

export class BackgroundBlur {
  /** The blurred camera, to send and to show as our own video */
  readonly track: MediaStreamTrack
  private readonly abort = new AbortController()
  private mask: OffscreenCanvas | null = null
  private alpha: Uint8ClampedArray | null = null
  private readonly background = new OffscreenCanvas(1, 1)
  private readonly person = new OffscreenCanvas(1, 1)
  private readonly output = new OffscreenCanvas(1, 1)

  private constructor(
    camera: MediaStreamTrack,
    private readonly model: ImageSegmenter
  ) {
    const processor = new MediaStreamTrackProcessor({ track: camera, maxBufferSize: 1 })
    const generator = new MediaStreamTrackGenerator({ kind: 'video' })
    this.track = generator
    const transform = new TransformStream<VideoFrame, VideoFrame>({
      transform: (frame, controller) => {
        try {
          controller.enqueue(this.process(frame))
        } catch {
          // Send the frame as it is rather than freezing the video
          controller.enqueue(frame.clone())
        } finally {
          frame.close()
        }
      }
    })
    void processor.readable
      .pipeThrough(transform, { signal: this.abort.signal })
      .pipeTo(generator.writable, { signal: this.abort.signal })
      .catch(() => undefined)
  }

  /** Blurs the background of a camera track, once the model has loaded. */
  static async create(camera: MediaStreamTrack): Promise<BackgroundBlur> {
    if (!blurSupported()) throw new Error('Background blur is not supported here')
    return new BackgroundBlur(camera, await loadSegmenter())
  }

  stop(): void {
    this.abort.abort()
    this.track.stop()
  }

  private process(frame: VideoFrame): VideoFrame {
    const width = frame.displayWidth
    const height = frame.displayHeight
    // Strictly increasing, also across blurs sharing the segmenter
    const timestamp = (lastTimestamp = Math.max(performance.now(), lastTimestamp + 1))
    const result = this.model.segmentForVideo(frame, timestamp)
    const confidence = result.confidenceMasks?.[0]
    if (!confidence) {
      result.close()
      return frame.clone()
    }
    const mask = this.updateMask(confidence.getAsFloat32Array(), confidence.width, confidence.height)
    result.close()

    for (const c of [this.person, this.output]) {
      if (c.width !== width || c.height !== height) Object.assign(c, { width, height })
    }
    const bw = Math.max(1, Math.round(width / BACKGROUND_SCALE))
    const bh = Math.max(1, Math.round(height / BACKGROUND_SCALE))
    if (this.background.width !== bw || this.background.height !== bh) {
      Object.assign(this.background, { width: bw, height: bh })
    }

    // The background: small, blurred, and scaled back up
    const bg = this.background.getContext('2d')!
    bg.filter = `blur(${BACKGROUND_BLUR}px)`
    bg.drawImage(frame, 0, 0, bw, bh)
    // The person: the mask scaled up (which softens its edges), filled with the frame
    const person = this.person.getContext('2d')!
    person.globalCompositeOperation = 'copy'
    person.filter = 'blur(2px)'
    person.drawImage(mask, 0, 0, width, height)
    person.filter = 'none'
    person.globalCompositeOperation = 'source-in'
    person.drawImage(frame, 0, 0, width, height)

    const out = this.output.getContext('2d')!
    out.imageSmoothingQuality = 'high'
    out.drawImage(this.background, 0, 0, width, height)
    out.drawImage(this.person, 0, 0)
    return new VideoFrame(this.output, { timestamp: frame.timestamp })
  }

  /** The person's confidence as the alpha of a small canvas, smoothed over time. */
  private updateMask(confidence: Float32Array, width: number, height: number): OffscreenCanvas {
    if (!this.mask || this.mask.width !== width || this.mask.height !== height) {
      this.mask = new OffscreenCanvas(width, height)
      this.alpha = null
    }
    const pixels = width * height
    const previous = this.alpha
    const alpha = new Uint8ClampedArray(pixels * 4)
    for (let i = 0; i < pixels; i++) {
      const now = confidence[i] * 255
      alpha[i * 4 + 3] = previous ? previous[i * 4 + 3] * MASK_SMOOTHING + now * (1 - MASK_SMOOTHING) : now
    }
    this.alpha = alpha
    this.mask.getContext('2d')!.putImageData(new ImageData(alpha, width, height), 0, 0)
    return this.mask
  }
}
