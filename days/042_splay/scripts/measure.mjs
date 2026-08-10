// Read back a capture and report the numbers this series argues with: the mean
// level of a rectangle (does the frame deliver the same light?), its R/B ratio
// (did the hue move?) and — from Day 042 — the standard deviation of luminance
// inside it (is there any *detail* there?).
//
// The third one was added because the second one turned out not to be the
// measurement today needed. Anisotropic filtering does not change what a lobe
// averages to, it changes how much of the picture survives the averaging, and a
// mean over a box is deliberately blind to that. sd is not: the leaded lattice
// is a ±6% modulation at about 8 px on the near tablet, so blurring it away
// takes the box's sd down with it while leaving the mean where it was.
//
// It is reported over the *luminance* rather than per channel because the
// quarry lattice is a brightness feature, and the grain the present pass adds
// (±1.6% uniform, uncorrelated) is a known floor under it: about 1.2 levels of
// sd on its own, which is small against the 10-20 the lattice carries and is in
// any case identical between two renders that differ by one uniform.
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
  let l1 = 0
  let l2 = 0
  let n = 0
  for (let y = by; y < Math.min(by + bh, img.h); y++) {
    for (let x = bx; x < Math.min(bx + bw, img.w); x++) {
      const i = (y * img.w + x) * img.bpp
      r += img.px[i]
      g += img.px[i + 1]
      b += img.px[i + 2]
      const l = 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2]
      l1 += l
      l2 += l * l
      n++
    }
  }
  r /= n
  g /= n
  b /= n
  const sd = Math.sqrt(Math.max(0, l2 / n - (l1 / n) ** 2))

  // The measurement Day 042 is actually about. A scalar sd cannot tell an
  // anisotropic filter from an isotropic one, because making a picture blurrier
  // one way and sharper the other leaves the variance about where it was. The
  // RMS first difference along each axis can: gx falls when the leads smear
  // across, gy when they smear up, and the *ratio* is the orientation of the
  // filter, read straight off the render.
  //
  // Both are RMS of a difference of two independent grain samples, so the
  // present pass's ±1.6% dither sits under both equally and cancels out of the
  // ratio, which is why the ratio is the number quoted and not gx alone.
  const x1 = Math.max(bx, 0)
  const y1 = Math.max(by, 0)
  const x2 = Math.min(bx + bw, img.w) - 1
  const y2 = Math.min(by + bh, img.h) - 1
  const lum = (x, y) => {
    const i = (y * img.w + x) * img.bpp
    return 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2]
  }
  let gx = 0
  let gy = 0
  let gn = 0
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      gx += (lum(x + 1, y) - lum(x, y)) ** 2
      gy += (lum(x, y + 1) - lum(x, y)) ** 2
      gn++
    }
  }
  gx = Math.sqrt(gx / Math.max(gn, 1))
  gy = Math.sqrt(gy / Math.max(gn, 1))

  console.log(
    `${path} [${bx},${by} ${bw}x${bh}]  mean=${((r + g + b) / 3).toFixed(2)}  ` +
      `rgb=${r.toFixed(1)}/${g.toFixed(1)}/${b.toFixed(1)}  R/B=${(r / b).toFixed(3)}  ` +
      `sd=${sd.toFixed(2)}  gx=${gx.toFixed(2)} gy=${gy.toFixed(2)} gx/gy=${(gx / gy).toFixed(3)}`
  )
}
