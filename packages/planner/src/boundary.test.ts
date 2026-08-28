import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The planner is pure. It has one dependency and does no I/O, which is what makes
 * the same query produce a byte-identical plan and makes the demo safe to run
 * live. This test is the mechanical version of that promise.
 */
describe('planner boundary', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string> }

  it('depends on the schema and nothing else', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@relokit/schema'])
  })

  it('never reaches for the network, the clock or the filesystem', () => {
    const sources = ['cardinality.ts', 'score.ts', 'registry.ts', 'index.ts']
    for (const file of sources) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(src).not.toMatch(/\bfetch\(|\bDate\.now\(|\bMath\.random\(|from 'node:/)
    }
  })
})
