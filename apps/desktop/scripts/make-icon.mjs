/**
 * Generate build/icon.png — a 256x256 app icon, with no image dependencies.
 *
 * electron-builder converts this to .ico for the window, taskbar, installer
 * and desktop shortcut. Drawn to the same palette as the app: a warm-free,
 * cyan-to-blue mark on near black.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 256
const px = Buffer.alloc(S * S * 4)

const set = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  // Simple source-over blend against whatever is already there.
  const sa = a / 255
  px[i] = Math.round(r * sa + px[i] * (1 - sa))
  px[i + 1] = Math.round(g * sa + px[i + 1] * (1 - sa))
  px[i + 2] = Math.round(b * sa + px[i + 2] * (1 - sa))
  px[i + 3] = Math.max(px[i + 3], Math.round(a))
}

/** Signed distance to a rounded rectangle, for cheap antialiasing. */
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - (hw - r)
  const dy = Math.abs(y - cy) - (hh - r)
  const ax = Math.max(dx, 0)
  const ay = Math.max(dy, 0)
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - r
}

// --- body: rounded square, cyan (top-left) to blue (bottom-right) ----------
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = roundRect(x, y, 128, 128, 112, 112, 56)
    if (d > 1) continue
    const t = (x + y) / (S * 2)
    const r = Math.round(0x3f + (0x4c - 0x3f) * t)
    const g = Math.round(0xe0 + (0x8d - 0xe0) * t)
    const b = Math.round(0xe8 + (0xff - 0xe8) * t)
    set(x, y, r, g, b, 255 * Math.min(1, Math.max(0, 1 - d)))
  }
}

// --- speech bubble knocked out of the body, in near black -----------------
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const d = roundRect(x, y, 128, 118, 62, 48, 20)
    if (d < 1) set(x, y, 0x04, 0x07, 0x0a, 255 * Math.min(1, Math.max(0, 1 - d)))
  }
}
// tail
for (let y = 160; y < 200; y++) {
  const w = Math.round((200 - y) * 0.7)
  for (let x = 104; x < 104 + w; x++) set(x, y, 0x04, 0x07, 0x0a, 255)
}

// --- three dots inside the bubble -----------------------------------------
for (const cx of [100, 128, 156]) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - 118) - 9
      if (d < 1) {
        const t = (x + y) / (S * 2)
        set(x, y, Math.round(0x3f + (0x4c - 0x3f) * t), Math.round(0xe0 + (0x8d - 0xe0) * t),
            Math.round(0xe8 + (0xff - 0xe8) * t), 255 * Math.min(1, Math.max(0, 1 - d)))
      }
    }
  }
}

// --- encode PNG ------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8      // bit depth
ihdr[9] = 6      // RGBA
const raw = Buffer.alloc((S * 4 + 1) * S)
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

/**
 * The same mark, small enough for the system tray.
 *
 * The tray had a one-pixel transparent placeholder in it - put there before
 * any art existed and never replaced - so it showed as an empty square beside
 * every other program's icon.
 *
 * Drawn once at 256 and averaged down rather than drawn again at 32: the
 * shapes are positioned with hardcoded coordinates, and a second set for a
 * second size is a second thing to keep in step. Averaged over the alpha as
 * well, or the transparent edges pull the colours towards black and the mark
 * comes out with a dark fringe.
 */
function shrink(src, from, to) {
  const step = from / to
  const out = Buffer.alloc(to * to * 4)
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = Math.floor(y * step); sy < Math.floor((y + 1) * step); sy++) {
        for (let sx = Math.floor(x * step); sx < Math.floor((x + 1) * step); sx++) {
          const i = (sy * from + sx) * 4
          const sa = src[i + 3] / 255
          r += src[i] * sa; g += src[i + 1] * sa; b += src[i + 2] * sa
          a += src[i + 3]; n++
        }
      }
      const o = (y * to + x) * 4
      const alpha = a / n
      const weight = alpha > 0 ? (a / 255) : 1
      out[o] = Math.round(r / weight)
      out[o + 1] = Math.round(g / weight)
      out[o + 2] = Math.round(b / weight)
      out[o + 3] = Math.round(alpha)
    }
  }
  return out
}

function encode(pixels, size) {
  const head = Buffer.alloc(13)
  head.writeUInt32BE(size, 0)
  head.writeUInt32BE(size, 4)
  head[8] = 8
  head[9] = 6
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'icon.png'), png)
console.log(`wrote build/icon.png (${S}x${S}, ${png.length} bytes)`)

const TRAY = 32
const tray = encode(shrink(px, S, TRAY), TRAY)
writeFileSync(join(out, 'tray.png'), tray)
console.log(`wrote build/tray.png (${TRAY}x${TRAY}, ${tray.length} bytes)`)
