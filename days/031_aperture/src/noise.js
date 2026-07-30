import * as THREE from 'three'

/**
 * A tileable 3D noise volume — the first texture this project has ever built in
 * more than two dimensions.
 *
 * Why not the usual GLSL value noise? Because today's inner loop runs it 56
 * times per pixel. A software 3D noise costs eight hashes and seven mixes per
 * evaluation; a `sampler3D` with LinearFilter costs one fetch, and the trilinear
 * interpolation between lattice points — which is *exactly* what value noise is
 * — happens in the texture unit for free. Fill 32³ texels with random numbers
 * and RepeatWrapping, and the hardware hands back tiling value noise.
 *
 * Two octaves are two fetches. The march can afford that; it could not afford
 * two hundred hashes.
 */

// deterministic, so the haze is the same shape on every machine and in every
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
