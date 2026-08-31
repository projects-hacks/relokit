import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Nothing committed may carry a credential.
 *
 * Three keys reached a public repository because `xano workspace pull` writes
 * the instance's own environment variables into the workspace file, and that
 * file was tracked. Deleting them later does not help: git keeps everything,
 * and a public repository publishes the history as much as the checkout. This
 * fails the suite rather than trusting anyone to notice again.
 */
const SIGNATURES: [string, RegExp][] = [
  ['an NVIDIA key', /\bnvapi-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI or OpenRouter key', /\bsk-(?:or-)?[A-Za-z0-9-]{20,}/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  // How the leak actually happened: an env block inside a pulled Xano file.
  ['a Xano environment block', /^\s*env\s*=\s*\{/m],
]

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((path) => path !== '' && !path.startsWith('fixtures/'))

describe('nothing tracked carries a credential', () => {
  it.each(SIGNATURES)('finds no file holding %s', (_name, pattern) => {
    const guilty = tracked.filter((path) => {
      // This file names the shapes it looks for, so it always matches itself.
      if (path.endsWith('secret-scan/src/scan.test.ts')) return false
      try {
        return pattern.test(readFileSync(path, 'utf8'))
      } catch {
        return false
      }
    })
    expect(guilty).toEqual([])
  })
})
