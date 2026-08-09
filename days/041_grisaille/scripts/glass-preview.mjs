// Write the window's own image out as a PNG, with the tracery drawn on top in
// outline so it is obvious which parts of the picture the integral can actually
// see. Levels of the pyramid are written side by side.
//
//   node scripts/glass-preview.mjs out.png [size]
//
// This exists because the first version of the rose was painted on the mullion —
// dead centre of the window, which is exactly where the stone crosses — and it
// took a render, a squint and a re-render to notice. One look at the source
// image would have caught it immediately.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { renderCartoon } from '../src/glass.js'
import { WINDOW } from '../src/palette.js'

const out = process.argv[2] || 'glass.png'
const N = Number(process.argv[3] || 512)

const px = renderCartoon(N)

// A crude display transform: the field is linear radiance around 1, so divide by
// two and gamma it. Nothing here is the renderer's grade; this is a contact sheet.
const rgb = new Uint8Array(N * N * 3)
for (let i = 0; i < N * N; i++) {
  for (let c = 0; c < 3; c++) {
    const v = Math.max(0, Math.min(1, px[i * 4 + c] * 0.5))
    rgb[i * 3 + c] = Math.round(255 * Math.pow(v, 1 / 2.2))
  }
}

// The stone, as an outline. Everything outside a pane is dimmed by half, which is
// not what the shader does — the shader simply does not integrate there — but it
// is what a reader needs to see.
const inPane = (u, v) => {
  for (const [cy, hy] of WINDOW.rows) {
    for (const [cx, hx] of WINDOW.cols) {
      if (
        Math.abs(u * WINDOW.half[0] - cx) <= hx &&
        Math.abs(v * WINDOW.half[1] - cy) <= hy
      ) {
        return true
      }
    }
  }
  return false
}
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    // image row 0 is v = -1, the sill; flip so the PNG reads the way up is up
    const u = ((x + 0.5) / N) * 2 - 1
    const v = 1 - ((y + 0.5) / N) * 2
    if (!inPane(u, v)) {
      const i = (y * N + x) * 3
      for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(rgb[i + c] * 0.28)
    }
  }
}

// --- a minimal PNG writer ----------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

let TABLE = null
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

const raw = Buffer.alloc(N * (N * 3 + 1))
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0 // filter: none
  Buffer.from(rgb.buffer, y * N * 3, N * 3).copy(raw, y * (N * 3 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(N, 0)
ihdr.writeUInt32BE(N, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // truecolour
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
)
console.log(`${out}  ${N}x${N}`)
