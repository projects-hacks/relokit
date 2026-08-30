import { describe, expect, it } from 'vitest'
import { configFromEnv, relay } from '../../../apps/proxy/src/relay.ts'

const config = { instance: 'https://x.example', group: 'g1', orgKey: 'secret' }

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
