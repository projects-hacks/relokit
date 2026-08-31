import { describe, expect, it } from 'vitest'
import { locate } from './locate.ts'

describe('a location request nobody answers', () => {
  it('gives up rather than waiting forever', async () => {
    // A permission prompt left sitting calls neither callback, and the browser's
    // own timeout has not started because permission never came. This hung the
    // deployed site for as long as the page stayed open.
    Object.defineProperty(globalThis, 'navigator', {
      value: { geolocation: { getCurrentPosition: () => {} } },
      configurable: true,
    })
    const started = Date.now()
    await expect(locate(120)).rejects.toThrow(/no answer/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('says so when the browser has no geolocation at all', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
    await expect(locate(500)).rejects.toThrow(/cannot share a location/)
  })
})
