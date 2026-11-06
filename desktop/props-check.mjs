/**
 * Catch two `style:` keys in one props object.
 *
 * JavaScript keeps the last key and silently drops the first, so a second style added to an existing
 * element removes whatever the first one set — no error, no warning, and `node --check` cannot see it.
 * This script walks `desktop/plugin.js` line by line: two `style:` lines at the same indentation with no
 * other `jsx(`/`jsxs(` between them belong to the same object.
 *
 *   node desktop/props-check.mjs
 *
 * Exit 1 names every pair; exit 0 means none.
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] || new URL('plugin.js', import.meta.url).pathname
const lines = readFileSync(file, 'utf8').split('\n')
const pairs = []

lines.forEach((line, index) => {
  if (!line.trimStart().startsWith('style:')) return
  const indent = line.length - line.trimStart().length
  for (let next = index + 1; next < Math.min(index + 40, lines.length); next += 1) {
    const text = lines[next]
    if (text.includes('jsx(') || text.includes('jsxs(')) break
    if (!text.trimStart().startsWith('style:')) continue
    if (text.length - text.trimStart().length === indent) {
      pairs.push([index + 1, next + 1])
    }
    break
  }
})

if (pairs.length === 0) {
  console.log(`props: ok (${lines.length} lines, one style per object)`)
  process.exit(0)
}

console.log('props: FAIL — two style keys in one props object:')
for (const [first, second] of pairs) {
  console.log(`  line ${first} and line ${second}`)
}
console.log('Keep one object: move the second key into the first.')
process.exit(1)
