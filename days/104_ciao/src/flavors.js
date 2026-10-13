// 下のスライダーの虹（ref の y=834 を 30px おきに実測）。この1本の表が缶・光だまり・名前の全部の出どころ
export const STOPS = [
  [0.0, '#888bd4'], [0.12, '#00a5e2'], [0.3, '#65bb9e'], [0.5, '#d6b471'],
  [0.62, '#eba99e'], [0.8, '#e69be3'], [1.0, '#fe68a0'],
]
export const FLAVORS = [
  ['QUIET', 'LYCHEE'], ['COLD', 'MINT'], ['SOFT', 'LIME'],
  ['SLOW', 'MANGO'], ['HALF', 'PEACH'], ['DARK', 'CHERRY'],
]
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
export function grad(s) {
  s = Math.min(1, Math.max(0, s))
  for (let i = 1; i < STOPS.length; i++) {
    const [s1, c1] = STOPS[i], [s0, c0] = STOPS[i - 1]
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0), a = hex(c0), b = hex(c1)
      return a.map((v, k) => v + (b[k] - v) * t)
    }
  }
  return hex(STOPS[STOPS.length - 1][1])
}
// 味 i の代表位置（つまみの止まる所）
export const flavorS = (i) => i / (FLAVORS.length - 1)
