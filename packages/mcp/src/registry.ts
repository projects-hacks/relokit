import { readFileSync } from 'node:fs'
import { Registry } from '@relokit/schema'

/**
 * Until Xano is reachable the registry is read from the seed, which is the same
 * file Xano imports. One source of truth either way.
 */
export function loadRegistry(): Registry {
  const path = new URL('../../../xano/registry.seed.json', import.meta.url)
  return Registry.parse(JSON.parse(readFileSync(path, 'utf8')))
}
