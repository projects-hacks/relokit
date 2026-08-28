import { describe, expect, it } from 'vitest'
import { createClient } from './client.ts'
import { fixtureKey, paramsHash } from './key.ts'
import { redactBody, redactParams } from './redact.ts'

describe('fixture key', () => {
  it('does not change when parameters are reordered', () => {
    const a = paramsHash('zillow', { sw_lat: 37.2, ne_lat: 37.4, listing_status: 'For_Rent' })
    const b = paramsHash('zillow', { listing_status: 'For_Rent', ne_lat: 37.4, sw_lat: 37.2 })
    expect(a).toBe(b)
  })

  it('changes when a parameter value changes', () => {
    expect(paramsHash('zillow', { page: 1 })).not.toBe(paramsHash('zillow', { page: 2 }))
  })

  it('ignores the credential, so the same call has one identity', () => {
    const withKey = paramsHash('zillow', { page: 1, api_key: 'secret' })
    expect(withKey).toBe(paramsHash('zillow', { page: 1 }))
  })

  it('reads as a filename', () => {
    expect(fixtureKey('zillow', { page: 1 }, 'san-jose-1bed')).toMatch(
      /^zillow__san-jose-1bed__[0-9a-f]{16}$/,
    )
  })
})

describe('redaction', () => {
  it('drops the key from parameters', () => {
    expect(redactParams({ q: 'gym', api_key: 'sk-live-abc123' })).toEqual({ q: 'gym' })
  })

  it('drops the key from anywhere in the body', () => {
    const body = {
      search_metadata: { json_endpoint: 'https://serpapi.com/x.json?api_key=sk-live-abc123&q=gym' },
      search_parameters: { api_key: 'sk-live-abc123', engine: 'zillow' },
      nested: [{ raw_html_file: 'https://serpapi.com/y.html?api_key=sk-live-abc123' }],
    }
    expect(JSON.stringify(redactBody(body))).not.toContain('sk-live-abc123')
  })

  it('leaves an ordinary url alone', () => {
    const body = { url: 'https://www.zillow.com/homedetails/123_Main_St/?utm_source=x' }
    expect(redactBody(body)).toEqual(body)
  })
})

describe('replay mode', () => {
  it('refuses to reach the network on a miss and says how to record it', async () => {
    const client = createClient({ mode: 'replay' })
    await expect(client.search('zillow', { page: 999 }, 'nonexistent')).rejects.toThrow(
      /pnpm record nonexistent/,
    )
  })

  it('is the default, so no test can spend a credit by accident', () => {
    expect(createClient().mode).toBe('replay')
  })
})
