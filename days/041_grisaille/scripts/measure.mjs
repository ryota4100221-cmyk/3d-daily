// Read back a capture and report the two numbers this series argues with:
// the mean level of a rectangle (does the frame deliver the same light?) and
// its R/B ratio (did the hue move?).
//
//   node scripts/measure.mjs shot.png x y w h [x y w h ...]
//
// Chromaticity is the honest measurement here. The mean level of a TAA-and-
// froxel-accumulated frame drifts about ten per cent with which frame the
// screenshot lands on (Day 040), so a three per cent difference in brightness is
// inside the noise; R/B is nearly independent of how many frames accumulated.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function readPng(path) {
  const buf = readFileSync(path)
  let p = 8
  let w = 0
  let h = 0
  let bpp = 3
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bpp = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 1
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(h * stride)
  // undo the per-scanline filters
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prv = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prv[x]
      const c = x >= bpp ? prv[x - bpp] : 0
      let v = src[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }
  return { w, h, bpp, px: out }
}

const [path, ...rest] = process.argv.slice(2)
const img = readPng(path)
const boxes = []
for (let i = 0; i + 3 < rest.length; i += 4) boxes.push(rest.slice(i, i + 4).map(Number))
if (boxes.length === 0) boxes.push([0, 0, img.w, img.h])

for (const [bx, by, bw, bh] of boxes) {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = by; y < Math.min(by + bh, img.h); y++) {
    for (let x = bx; x < Math.min(bx + bw, img.w); x++) {
      const i = (y * img.w + x) * img.bpp
      r += img.px[i]
      g += img.px[i + 1]
      b += img.px[i + 2]
      n++
    }
  }
  r /= n
  g /= n
  b /= n
  console.log(
    `${path} [${bx},${by} ${bw}x${bh}]  mean=${((r + g + b) / 3).toFixed(2)}  ` +
      `rgb=${r.toFixed(1)}/${g.toFixed(1)}/${b.toFixed(1)}  R/B=${(r / b).toFixed(3)}`
  )
}
