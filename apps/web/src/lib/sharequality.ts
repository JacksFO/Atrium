/*
 * Remembered on this machine, not on the account.
 *
 * What a share can carry is a fact about somebody's upload, not about who
 * they are — the same person on a laptop tethered to a phone wants a
 * different answer from the same person at their desk.
 */
const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch { /* private window */ }
  },
}

/**
 * Screenshare quality.
 *
 * Sized against a roughly 4.5 Mbit/s home upload. The server sends one
 * copy of the stream to every viewer, so the cost is the bitrate times
 * the number of people watching - which is why the presets are described
 * by how many people can watch rather than by resolution alone.
 *
 * Publishing a screen with no options at all means capturing at whatever the
 * monitor happens to be - on a 1440p or 4K display that is an enormous number
 * of pixels to encode thirty times a second, and it is the sharer's CPU and
 * upload that pay for it. Capping capture is the single biggest saving
 * available, because pixels never captured are never encoded.
 *
 * contentHint matters more than it looks. 'motion' tells the encoder to keep
 * the frame rate and let sharpness go, which is right for a game; 'detail'
 * does the opposite. Getting it backwards is why shared text often looks
 * like porridge.
 *
 * There were two slower presets - 720p15 and a 1080p10 tuned for reading
 * code - and both are gone, asked for directly. Nothing here now drops below
 * thirty frames a second. The cost of that is real and worth writing down:
 * the cheapest option is 900 kbit rather than 600, so somebody on a weak
 * upload with three people watching has one fewer rung to climb down to.
 */
export type ShareQuality =
  | 'smooth' | 'high' | 'fluid' | 'large'

export type SharePreset = {
  id: ShareQuality
  name: string
  detail: string
  width: number
  height: number
  fps: number
  /** Bits per second. The ceiling, not the target. */
  maxBitrate: number
  /** Roughly how many people can watch at once on a normal home upload. */
  viewers: number
  /**
   * What kind of picture this is, for the encoder.
   *
   * Honoured for a camera, and *not always* for a screen: livekit-client
   * overrides it to 'motion' whenever a screen share is published with an SVC
   * codec, which VP9 is - deliberately, because Chrome caps L1T3 screenshare
   * at five frames a second otherwise. So while SCREEN_CODEC in voice.ts is
   * 'vp9', the value below is what the app asks for rather than what the
   * encoder is told. Set it back to 'vp8' there and this is honoured again.
   */
  contentHint: 'motion' | 'text' | 'detail'
  /**
   * What to give up when the line cannot carry it - and for every one of
   * these, not the resolution.
   *
   * Three of the four asked the encoder to hold the frame rate instead, which
   * means dropping resolution: a share picked as "720p 30" quietly became
   * something less than 720p whenever the upload tightened, and the number in
   * its name was a wish rather than a description. Reported as a share of a
   * screen full of small text being unreadable, and it is the same fault at
   * every size - 1080p that has become 720p is no better a promise kept.
   *
   * So the resolution is the thing held, at every preset, and the frame rate
   * is what gives. A share that cannot keep up now goes to fewer frames of
   * the size it said, rather than the same frames of a smaller picture. It is
   * still a field per preset rather than a constant, because the day one of
   * them genuinely wants fluidity above all it should say so here.
   */
  degradation: RTCDegradationPreference
}

export const SHARE_PRESETS: SharePreset[] = [
  {
    id: 'smooth', name: '720p 30', detail: 'The sensible default. Easiest on your upload.',
    width: 1280, height: 720, fps: 30, maxBitrate: 900_000, viewers: 4,
    contentHint: 'detail', degradation: 'maintain-resolution',
  },
  {
    id: 'fluid', name: '720p 60', detail: 'For fast games, without the full-size picture.',
    width: 1280, height: 720, fps: 60, maxBitrate: 1_800_000, viewers: 2,
    contentHint: 'motion', degradation: 'maintain-resolution',
  },
  {
    id: 'high', name: '1080p 30', detail: 'A clear, full-size picture.',
    width: 1920, height: 1080, fps: 30, maxBitrate: 2_500_000, viewers: 1,
    contentHint: 'detail', degradation: 'maintain-resolution',
  },
  {
    id: 'large', name: '1080p 60', detail: 'Both at once. Needs a very good upload.',
    width: 1920, height: 1080, fps: 60, maxBitrate: 4_000_000, viewers: 1,
    contentHint: 'motion', degradation: 'maintain-resolution',
  },
]

/**
 * What a preset actually is, in the two numbers people think in.
 *
 * Shown on the badge beside LIVE and beside every option, because "Balanced"
 * tells nobody whether their text will be readable and "720p 30FPS" does.
 */
export function qualityLabel(preset: SharePreset): string {
  return `${preset.height}p ${preset.fps}FPS`
}

/** "about four people can watch", in words rather than a bitrate. */
export function viewerHint(preset: SharePreset): string {
  return preset.viewers === 1
    ? 'best with one person watching'
    : `about ${preset.viewers} people can watch`
}

const SHARE_KEY = 'atrium.shareQuality'

/**
 * Balanced until somebody chooses otherwise.
 *
 * Named rather than taken as the first of the list. Light used to be first
 * and became the default by accident when the order changed; Light is gone
 * now, and naming it is still what stops the next reshuffle doing the same.
 */
const DEFAULT_QUALITY: ShareQuality = 'smooth'

export function shareQuality(): SharePreset {
  const id = storage.get(SHARE_KEY)
  return SHARE_PRESETS.find((p) => p.id === id)
    ?? SHARE_PRESETS.find((p) => p.id === DEFAULT_QUALITY)!
}

export function setShareQuality(id: ShareQuality): void {
  storage.set(SHARE_KEY, id)
}

/**
 * The preset somebody else says they are sharing at.
 *
 * Null rather than a default for anything unrecognised: an older client, or
 * a preset this one has never heard of, should show no badge at all rather
 * than a confident wrong one.
 */
export function presetById(id: string | null | undefined): SharePreset | null {
  if (!id) return null
  return SHARE_PRESETS.find((p) => p.id === id) ?? null
}
