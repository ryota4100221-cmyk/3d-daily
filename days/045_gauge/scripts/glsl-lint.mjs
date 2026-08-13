/**
 * The lint Day 039's NOTES asked for, at the top of its own list.
 *
 *   > **シェーダ文字列のバッククォートをlintで止める**。3日連続で踏んでいる。
 *
 * Four days running now, and the fourth was this morning: `softVisTint` in a
 * comment inside froxel.js's fragment shader, which closed the template literal
 * and handed rollup a fragment of English to parse. The error message points at
 * the right line, so it costs a minute rather than an hour — but a warning
 * written in capitals by the person who then trips over it the next day is not a
 * safeguard, it is a note about a safeguard that does not exist.
 *
 * The rule this enforces is narrow on purpose, because a wide one would have to
 * parse JavaScript:
 *
 *   a GLSL template literal opens at `/* glsl *` + `/` followed by a backtick,
 *   and closes on a line that is *nothing but* a backtick (with an optional
 *   trailing comma or paren). Any other backtick between the two is a mistake —
 *   there is no legal reason for one inside GLSL, where the character is not
 *   part of the language.
 *
 * Interpolations (`${...}`) are left alone; they are how the shared blocks are
 * pasted together and they contain no backticks of their own by the same rule.
 *
 * Runs as `prebuild`, so `npm run build` cannot succeed with one in the tree.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname
const OPEN = /\/\*\s*glsl\s*\*\/\s*`/
const CLOSE = /^\s*`[,)\];]*\s*$/

let bad = 0

for (const name of readdirSync(SRC).sort()) {
  if (!/\.(js|jsx)$/.test(name)) continue
  const lines = readFileSync(join(SRC, name), 'utf8').split('\n')

  let open = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!open) {
      if (OPEN.test(line)) {
        // The opening line's own trailing backtick is the delimiter; anything
        // after it on the same line would be GLSL, so check the remainder too.
        const rest = line.slice(line.search(OPEN) + line.match(OPEN)[0].length)
        if (rest.includes('`')) report(name, i + 1, rest.trim())
        open = true
      }
      continue
    }

    if (CLOSE.test(line)) {
      open = false
      continue
    }
    if (line.includes('`')) report(name, i + 1, line.trim())
  }

  if (open) report(name, lines.length, 'unterminated glsl template literal')
}

function report(file, line, text) {
  bad++
  console.error(`  ${file}:${line}  backtick inside a GLSL literal\n      ${text}`)
}

if (bad > 0) {
  console.error(
    `\nglsl-lint: ${bad} backtick${bad === 1 ? '' : 's'} inside shader source.\n` +
      'Use plain names in shader comments — a backtick ends the template literal\n' +
      'and rollup then parses the rest of the shader as JavaScript.\n'
  )
  process.exit(1)
}

console.log('glsl-lint: clean')
