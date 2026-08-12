import * as THREE from 'three'

/**
 * A tileable 3D noise volume (Day 031's, unchanged).
 *
 * Fill 32³ texels with random bytes, set LinearFilter and RepeatWrapping, and
 * the texture unit's trilinear interpolation *is* value noise — one fetch
 * instead of eight hashes and seven mixes.
 *
 * Today it is read 2.4 million times per frame instead of 19 million, because
 * the medium is evaluated once per froxel rather than once per march step per
 * pixel. Same texture, an order of magnitude less traffic.
 */

// deterministic, so the mist is the same shape on every machine and in every
// headless capture
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeNoiseVolume(size = 32) {
  const rand = mulberry32(0x31a97)
  const n = size * size * size
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.floor(rand() * 256)

  const tex = new THREE.Data3DTexture(data, size, size, size)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.wrapR = THREE.RepeatWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}
