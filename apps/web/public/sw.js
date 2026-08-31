/*
 * Enough to open without a network.
 *
 * The shell is served from cache first so the app starts on a train, and every
 * answer still comes from the backend, because a stale answer about somewhere to
 * live is worse than no answer. Nothing is precached by name: the built files
 * are hashed, so they are kept as they are asked for.
 */
const CACHE = 'relokit-v3'

self.addEventListener('install', (event) => {
  // The shell has to be taken deliberately. Everything else is cached as it is
  // asked for, but the first page load happens before this worker is running,
  // so waiting to be asked meant never holding the one file needed to open at
  // all, and a cold start offline showed the browser's error page.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add('/'))
      .catch(() => {
        // A shell we could not take is a worker that simply caches less.
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Answers and map tiles are somebody else's to serve. The API became
  // same-origin when the proxy arrived, so it has to be named here: cache-first
  // over /api would hand back yesterday's answer forever.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api')) return

  // A page request falls back to the last shell we held, so a cold start
  // offline opens the app rather than the browser's error.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        // Any address falls back to the shell, since the app routes itself and
        // a query string must not decide whether the page opens.
        .catch(() =>
          caches
            .match(request, { ignoreSearch: true })
            .then((hit) => hit ?? caches.match('/'))
            .then((hit) => hit ?? Response.error()),
        ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
