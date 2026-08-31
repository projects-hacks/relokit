import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Puts MapLibre's worker where MapLibre looks for it.
 *
 * The library builds the worker's URL at runtime, `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)` against the bundle's own location, so no bundler ever sees
 * the reference and none emits the file. The deployed map then requested a
 * script that did not exist, made no tile request at all, and reported nothing:
 * a blank map with a clean console, while the dev server, which does not
 * bundle, looked perfect.
 *
 * Copying both files beside the bundle satisfies that runtime URL and the
 * worker's own import of the shared chunk.
 */
// The package does not export its own package.json, so resolve a file it does
// export and step up from there.
const from = dirname(createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl.css'))
const into = join(import.meta.dirname, '..', 'dist', 'assets')
mkdirSync(into, { recursive: true })
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(from, file), join(into, file))
  console.log(`map worker: ${file}`)
}
