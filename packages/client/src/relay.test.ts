import { describe, expect, it } from 'vitest'
import { configFromEnv, relay } from '../../../apps/proxy/src/relay.ts'

const config = { instance: 'https://x.example', group: 'g1', orgKey: 'secret', patienceMs: 5000 }

describe('the passage to the backend', () => {
  it('refuses everything off the allowlist without touching the network', async () => {
    const answer = await relay(config, {
      method: 'GET',
      path: 'admin/org',
      search: new URLSearchParams(),
    })
    expect(answer.status).toBe(404)
  })

  it('refuses a verb nothing uses', async () => {
    const answer = await relay(config, {
      method: 'DELETE',
      path: 'runs',
      search: new URLSearchParams(),
    })
    expect(answer.status).toBe(404)
  })

  it('will not run without the key it exists to hold', () => {
    expect(() => configFromEnv({ XANO_INSTANCE_URL: 'https://x.example' })).toThrow()
    expect(
      configFromEnv({
        XANO_INSTANCE_URL: 'https://x.example/workspace',
        RELOKIT_ORG_KEY: 'k',
      }).instance,
    ).toBe('https://x.example')
  })
})

/**
 * The passage waited three minutes inside a function the platform kills after
 * sixty seconds, so a slow call could never return anything: the browser got an
 * unreadable gateway page and the run lost the fact for good. What follows is
 * that it must give up first, and say so in the app's own words.
 */
describe('when the backend is too slow to wait for', () => {
  it('gives up before the host does, and says what happened', async () => {
    const answer = await relay(
      { ...config, patienceMs: 20 },
      {
        method: 'GET',
        path: 'runs',
        search: new URLSearchParams(),
      },
    )
    expect(answer.status).toBe(504)
    expect(JSON.parse(answer.body).error).toMatch(/too long/)
  })

  it('waits less than a serverless function is given', () => {
    const { patienceMs } = configFromEnv({
      XANO_INSTANCE_URL: 'https://x.example',
      RELOKIT_ORG_KEY: 'secret',
    })
    expect(patienceMs).toBeLessThan(60_000)
  })
})
