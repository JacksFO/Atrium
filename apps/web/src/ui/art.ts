/**
 * The generated art.
 *
 * Every server tile, every avatar and every wallpaper is drawn from a seed
 * rather than fetched. That is the reason this app ships no images: what
 * somebody sees when they have not chosen a picture is a picture of their
 * own, and it is the same one every time because the seed is their id.
 *
 * Kept as plain functions taking a canvas, so the React parts stay small and
 * this stays testable without one.
 */

export type Theme = {
  /** Accent hue, base hue, how much colour, how much of it in the neutrals. */
  h: number
  bh: number
  tint: number
  nt: number
  mode: 'dark' | 'light'
}

/** A deterministic sequence from one number. The same seed is the same art. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

const col = (h: number, s: number, l: number, a = 1): string =>
  `hsla(${((h % 360) + 360) % 360},${Math.max(0, Math.min(100, s))}%,${
    Math.max(0, Math.min(100, l))}%,${a})`

/**
 * Size a canvas to what it is being shown at, and hand back a context in
 * those units.
 *
 * The pixel ratio is capped at two: past that the picture costs four times as
 * much to draw for a difference nobody has ever reported seeing.
 */
export function fit(
  cv: HTMLCanvasElement,
  height?: number,
): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const d = Math.min(window.devicePixelRatio || 1, 2)
  const w = cv.clientWidth
  const h = height || cv.clientHeight
  /* Nothing is drawn into a canvas with no size yet. Inventing one produces a
     picture at the wrong shape which is then stretched to fit — worse than
     drawing nothing and being asked again on the next frame. */
  if (!w || !h) return null
  cv.width = Math.max(1, Math.round(w * d))
  cv.height = Math.max(1, Math.round(h * d))
  const g = cv.getContext('2d')
  if (!g) return null
  g.setTransform(d, 0, 0, d, 0, 0)
  return { g, w, h }
}

/** A face: two gradients and two soft blobs, from their id. */
export function paintAvatar(cv: HTMLCanvasElement, T: Theme, seed: number): void {
  const f = fit(cv)
  if (!f) return
  const { g, w, h: H } = f
  const r = rng(seed || 1)
  const dark = T.mode === 'dark'
  const sat = Math.round(48 * T.tint) + 24
  const a = T.h + r() * 100 - 24
  const b = T.h + 50 + r() * 100
  const lin = g.createLinearGradient(0, 0, w, H)
  lin.addColorStop(0, col(a, sat, dark ? 58 : 52))
  lin.addColorStop(1, col(b, sat, dark ? 42 : 38))
  g.fillStyle = lin
  g.fillRect(0, 0, w, H)
  g.globalAlpha = 0.3
  g.fillStyle = '#fff'
  g.beginPath()
  g.arc(w * (0.22 + r() * 0.3), H * (0.14 + r() * 0.2), w * 0.44, 0, 7)
  g.fill()
  g.globalAlpha = 0.18
  g.fillStyle = '#000'
  g.beginPath()
  g.arc(w * (0.7 + r() * 0.2), H * (0.85 + r() * 0.2), w * 0.5, 0, 7)
  g.fill()
  g.globalAlpha = 1
}

/** A place: a sky, a moon, three ridges, some trees and water under it. */
export function paintScene(
  cv: HTMLCanvasElement,
  T: Theme,
  seed: number,
  height?: number,
): void {
  const f = fit(cv, height)
  if (!f) return
  const { g, w, h: H } = f
  const r = rng(seed || 1)
  const dark = T.mode === 'dark'
  const sat = Math.round(42 * T.tint) + 10

  const sky = g.createLinearGradient(0, 0, 0, H)
  if (dark) {
    sky.addColorStop(0, col(T.bh, sat, 7))
    sky.addColorStop(0.42, col(T.h + 26, sat + 6, 20))
    sky.addColorStop(0.68, col(T.h, sat + 12, 34))
    sky.addColorStop(1, col(T.h + 40, sat + 8, 26))
  } else {
    sky.addColorStop(0, col(T.h + 46, sat, 84))
    sky.addColorStop(0.45, col(T.h + 16, sat, 74))
    sky.addColorStop(1, col(T.bh, sat - 6, 90))
  }
  g.fillStyle = sky
  g.fillRect(0, 0, w, H)

  if (dark) {
    for (let s = 0; s < 110; s++) {
      g.globalAlpha = 0.55 * r()
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(r() * w, r() * H * 0.6, r() * 1.1 + 0.2, 0, 7)
      g.fill()
    }
  }
  g.globalAlpha = 1

  const mx = w * (0.16 + r() * 0.66)
  const my = H * (0.2 + r() * 0.14)
  const mr = Math.max(8, H * 0.075)
  const glow = g.createRadialGradient(mx, my, 0, mx, my, mr * 6)
  glow.addColorStop(0, col(T.h + 46, sat + 22, dark ? 70 : 88, 0.6))
  glow.addColorStop(1, col(T.h + 46, sat, 60, 0))
  g.fillStyle = glow
  g.beginPath()
  g.arc(mx, my, mr * 6, 0, 7)
  g.fill()
  g.fillStyle = dark ? '#FFF6E6' : '#FFFEF7'
  g.beginPath()
  g.arc(mx, my, mr, 0, 7)
  g.fill()

  const ridge = (by: number, ro: number, l: number, al: number, st: number) => {
    g.beginPath()
    g.moveTo(0, H)
    let y = by
    for (let x = 0; x <= w; x += st) {
      y += (r() - 0.5) * ro
      y = Math.max(by - H * 0.22, Math.min(by + H * 0.13, y))
      g.lineTo(x, y)
    }
    g.lineTo(w, H)
    g.closePath()
    g.globalAlpha = al
    g.fillStyle = col(T.bh, sat, l)
    g.fill()
    g.globalAlpha = 1
  }
  ridge(H * 0.5, H * 0.07, dark ? 16 : 66, dark ? 0.55 : 0.4, 14)
  ridge(H * 0.62, H * 0.055, dark ? 11 : 55, dark ? 0.8 : 0.55, 11)
  ridge(H * 0.72, H * 0.04, dark ? 6 : 42, dark ? 0.96 : 0.74, 9)

  if (w > 60) {
    g.globalAlpha = dark ? 0.98 : 0.82
    g.fillStyle = col(T.bh, sat, dark ? 4 : 32)
    const ty = H * 0.775
    for (let x = -4; x < w + 8; x += Math.max(5, w / 70)) {
      const th = H * (0.05 + r() * 0.09)
      const bw = Math.max(3, w / 85)
      g.beginPath()
      g.moveTo(x, ty + H * 0.02)
      g.lineTo(x + bw / 2, ty - th)
      g.lineTo(x + bw, ty + H * 0.02)
      g.closePath()
      g.fill()
    }
    g.globalAlpha = 1
  }

  const wl = H * 0.8
  const water = g.createLinearGradient(0, wl, 0, H)
  water.addColorStop(0, col(T.h, sat + 8, dark ? 26 : 64, 0.75))
  water.addColorStop(1, col(T.bh, sat, dark ? 4 : 78))
  g.fillStyle = water
  g.fillRect(0, wl, w, H - wl)

  /* The moon's reflection, directly under it. */
  g.globalAlpha = 0.5
  g.fillStyle = dark ? '#FFF6E6' : '#FFFFFF'
  for (let ln = 0; ln < 9; ln++) {
    const ly = wl + ln * ((H - wl) / 9) + 1
    const lw = mr * (2.6 - ln * 0.22) * (0.45 + r() * 0.75)
    g.fillRect(mx - lw / 2, ly, Math.max(2, lw), Math.max(1, H * 0.006))
  }
  g.globalAlpha = 1
}
