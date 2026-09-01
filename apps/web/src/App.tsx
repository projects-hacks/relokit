import { useEffect, useState } from 'react'
import type { AskEvent } from '@relokit/client'
import { applyRelaxation } from '@relokit/evidence'
import { SUBJECT_WORDS } from '@relokit/schema'
import { useAsk } from './useAsk.ts'
import { useDeferred } from './lib/deferred.ts'
import { useSaved } from './lib/saved.ts'
import { Toast, useToast } from './lib/toast.tsx'
import { ago, money } from './lib/format.ts'
import { Ask } from './panels/Ask.tsx'
import { Plan } from './panels/Plan.tsx'
import { Counter } from './panels/Counter.tsx'
import { Working } from './panels/Working.tsx'
import { Brief } from './panels/Brief.tsx'
import { SavedLocations } from './panels/SavedLocations.tsx'
import { Watch } from './panels/Watch.tsx'
import { useWide } from './lib/wide.ts'
import { Findings } from './findings/Findings.tsx'
import { Detail } from './findings/Detail.tsx'
import { Nothing } from './findings/Nothing.tsx'
import { FindingsSkeleton } from './findings/Skeleton.tsx'
import { Offers } from './findings/Offers.tsx'
import { Map, type MapTheme } from './map/Map.tsx'
import { Peek } from './map/Peek.tsx'
import { Landing } from './Landing.tsx'

const asked = () => new URLSearchParams(location.search).get('q')?.trim() ?? ''
const inApp = () => location.hash === '#app' || location.search.includes('demo') || asked() !== ''

export function App() {
  const { status, events, result, query, error, restored, run, stop, dismiss } = useAsk()
  // The address bar is the router: the landing at /, the app at #app, and the
  // back button works because the hash is the state.
  const [view, setView] = useState<'landing' | 'app'>(() => (inApp() ? 'app' : 'landing'))
  useEffect(() => {
    const sync = () => setView(inApp() ? 'app' : 'landing')
    addEventListener('hashchange', sync)
    return () => removeEventListener('hashchange', sync)
  }, [])

  // A question in the address makes an answer something you can send to
  // somebody, come back to, or open from a list of examples. Asking it again
  // is answered from the ledger and usually costs nothing.
  useEffect(() => {
    const shared = asked()
    if (shared) run(shared)
    // Only what the page was opened with. Later questions set the address
    // themselves rather than being re-run by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const enterApp = (question?: string) => {
    const url = new URL(location.href)
    if (question) url.searchParams.set('q', question)
    url.hash = '#app'
    history.pushState(null, '', url)
    setView('app')
    if (question) run(question)
  }
  const [openId, setOpenId] = useState<string | null>(null)
  // Selecting shows a home on the map. Opening covers the map, so it is a
  // separate act rather than the same click doing both.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // Whether the pointer is over the map or the list, the same home is lit in
  // both. Pointing at a pin should not mean hunting for its card.
  const [fromMap, setFromMap] = useState(false)
  const saved = useSaved(result?.constraint_set.raw_query ?? '')
  const working = useDeferred(status === 'running' && !result)
  const wide = useWide()
  // One question worth tracking, rendered in one of two places. The fixture
  // demo is nobody's saved question.
  const watchable = result !== null && !working && status === 'done' && result.run_id !== 0
  const notice = useToast()
  // On a phone the answer comes first and the map is asked for. Above that it
  // is always open and the control is not rendered at all.
  const [mapShut, setMapShut] = useState(true)
  const [savedOpen, setSavedOpen] = useState(false)
  const [mapTheme, setMapTheme] = useState<MapTheme>(() => {
    try {
      return localStorage.getItem('relokit-map-theme') === 'dark' ? 'dark' : 'bright'
    } catch {
      return 'bright'
    }
  })
  // The end of the run is as much a thing to be told as the middle of it.
  const progress =
    status === 'running'
      ? describe(events)
      : result
        ? `${result.buckets.results.length} of ${result.entities.length} ${SUBJECT_WORDS[result.constraint_set.subject].many} cleared every requirement`
        : status === 'failed'
          ? `The run stopped: ${error ?? 'no reason given'}`
          : ''

  const planned = events.find(
    (event): event is Extract<AskEvent, { kind: 'planned' }> => event.kind === 'planned',
  )
  // A restored run carries no events, so the plan comes off the result instead.
  // Without this the map never fits its bounds and sits on a hardcoded centre.
  const plan = planned?.plan ?? result?.plan ?? null
  useEffect(() => {
    if (!fromMap || !hoveredId) return
    document
      .querySelector(`[data-entity="${CSS.escape(hoveredId)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [fromMap, hoveredId])
  useEffect(() => {
    try {
      localStorage.setItem('relokit-map-theme', mapTheme)
    } catch {
      // A preference that cannot be kept is still a working page.
    }
  }, [mapTheme])

  const selected = selectedId
    ? (result?.entities.find((e) => e.entity_id === selectedId) ?? null)
    : null
  const open = openId ? result?.entities.find((e) => e.entity_id === openId) : undefined
  const openEvidence =
    result && openId
      ? [
          ...result.buckets.results,
          ...result.buckets.unverified,
          ...result.buckets.rejections,
        ].find((entry) => entry.entity_id === openId)?.evidence
      : undefined

  return (
    <div
      className="shell"
      data-answered={String(Boolean(result))}
      data-map={mapShut ? 'shut' : 'open'}
    >
      {/* One region, present from the start, so a reader is told how the run is
          going rather than left with a page that silently rearranges itself. */}
      <div className="sr-only" role="status" aria-live="polite">
        {progress}
      </div>

      <a className="skip" href="#results">
        Skip to results
      </a>

      <header className="masthead">
        <a
          className="brand-home"
          href="/"
          onClick={(event) => {
            event.preventDefault()
            history.pushState(null, '', '/')
            setView('landing')
          }}
        >
          <h1 className="wordmark">
            Relo<span>kit</span>
          </h1>
        </a>
        <p className="strapline">The whole picture, in one question</p>
        {saved.homes.length > 0 && (
          <button className="saved-access" onClick={() => setSavedOpen(true)}>
            <span aria-hidden="true">★</span>
            <span className="saved-access-text">Saved</span>
            <b>{saved.homes.length}</b>
          </button>
        )}
      </header>

      {view === 'landing' && <Landing onSearch={enterApp} />}

      {view === 'app' && (
        <div className="columns">
          <aside className="rail">
            <Ask
              onAsk={(question) => {
                // Every question earns an address, wherever it was typed, so
                // the answer on screen is always one somebody could send on.
                const url = new URL(location.href)
                url.searchParams.set('q', question)
                url.hash = '#app'
                history.pushState(null, '', url)
                run(question)
              }}
              onStop={stop}
              busy={status === 'running'}
              asking={query}
              subject={result?.constraint_set.subject ?? null}
            />
            <Plan plan={plan} events={events} />
            {/* The rail is the method: what will be checked, then how it was,
                then keeping it checked. It has the room, and it keeps the
                answer column to answers. */}
            {result && !working && <Working result={result} />}
            {/* The fixture demo is nobody's saved question. */}
            {wide && watchable && <Watch result={result} />}
          </aside>

          {/* On a phone the map and the list are two views of the same
              answer, so they take turns and the way between them follows the
              reader rather than sitting under everything they have not read
              yet. Above that width both are on screen and this is not rendered. */}
          <button
            className="view-switch"
            onClick={() => setMapShut((current) => !current)}
            aria-pressed={!mapShut}
          >
            <span aria-hidden="true">{mapShut ? '◉' : '☰'}</span>
            {mapShut ? 'Map' : 'List'}
          </button>

          <main className="stage" data-shut={String(mapShut)} data-theme={mapTheme}>
            <Map
              theme={mapTheme}
              shut={mapShut}
              plan={plan}
              result={result}
              selected={selectedId}
              hovered={hoveredId}
              onSelect={setSelectedId}
              onHover={(id) => {
                setFromMap(id !== null)
                setHoveredId(id)
              }}
              onOpen={setOpenId}
            />

            {/* Only where the list is not beside the map. On a wide screen the
                card is already on screen and this would repeat it. */}
            {selected && (
              <Peek
                place={selected}
                onOpen={() => setOpenId(selected.entity_id)}
                onDismiss={() => setSelectedId(null)}
              />
            )}

            <div className="map-theme" role="group" aria-label="Map colour">
              <button
                type="button"
                data-active={String(mapTheme === 'bright')}
                aria-pressed={mapTheme === 'bright'}
                onClick={() => setMapTheme('bright')}
              >
                Bright
              </button>
              <button
                type="button"
                data-active={String(mapTheme === 'dark')}
                aria-pressed={mapTheme === 'dark'}
                onClick={() => setMapTheme('dark')}
              >
                Dark
              </button>
            </div>
            <Counter events={events} />
          </main>

          <section className="paper" id="results">
            {status === 'idle' && saved.homes.length === 0 && <Brief onAsk={run} />}

            {status === 'idle' && saved.homes.length > 0 && (
              <section>
                <p className="eyebrow">Kept for later</p>
                <div className="saved-strip">
                  {saved.homes.map((home) => (
                    <a
                      className="saved-card"
                      key={home.entity_id}
                      href={home.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {home.photo_url && (
                        <img
                          src={home.photo_url}
                          alt=""
                          width={96}
                          height={64}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.remove()
                          }}
                        />
                      )}
                      <span>
                        <b>{money(home.price_cents) ?? '—'}</b>
                        <br />
                        {home.title.slice(0, 48)}
                      </span>
                    </a>
                  ))}
                </div>
                <button
                  className="as-link"
                  onClick={() => {
                    const restore = saved.clear()
                    notice.show('Saved places cleared.', restore)
                  }}
                >
                  Clear the list
                </button>
              </section>
            )}

            {working && (
              <>
                <p className="pending">{progress}</p>
                <FindingsSkeleton />
              </>
            )}

            {status === 'failed' && (
              <div className="failure">
                <p className="eyebrow">The run stopped</p>
                <p className="note">{error}</p>
              </div>
            )}

            {restored && (
              <div className="restored">
                <span>
                  Showing what you asked {ago(restored.at)}: “{restored.query.slice(0, 54)}
                  {restored.query.length > 54 ? '…' : ''}”
                </span>
                <button onClick={dismiss}>Clear</button>
              </div>
            )}

            {result && result.problems.length > 0 && result.entities.length > 0 && (
              <p className="note partial">
                {result.problems.length} {result.problems.length === 1 ? 'call' : 'calls'} did not
                happen, so some results were checked less thoroughly than others.
              </p>
            )}

            {result && !working && (
              <>
                {result.entities.length === 0 ? (
                  <Nothing result={result} />
                ) : (
                  <Findings
                    result={result}
                    isSaved={saved.isSaved}
                    onSave={(home) => {
                      notice.show(saved.isSaved(home.entity_id) ? 'Removed.' : 'Saved.')
                      saved.toggle(home)
                    }}
                    onOpen={setOpenId}
                    onSelect={setSelectedId}
                    onHover={(id) => {
                      setFromMap(false)
                      setHoveredId(id)
                    }}
                    selected={selectedId}
                    hovered={hoveredId}
                  />
                )}
                <Offers
                  result={result}
                  onRelax={(constraintId, to) => {
                    // Asking again with one bound moved. Only that bound changes,
                    // and it is marked as ours so the interface can say the
                    // number stopped being theirs.
                    run(result.constraint_set.raw_query, {
                      ...result.constraint_set,
                      constraints: applyRelaxation(
                        result.constraint_set.constraints,
                        constraintId,
                        to,
                      ),
                    })
                  }}
                />
                {/* On a phone the rail stacks above the answer, so tracking is
                    rendered here instead: nothing the reader has to scroll past
                    to reach what they asked for. */}
                {!wide && watchable && <Watch result={result} />}
              </>
            )}
          </section>
        </div>
      )}

      <Toast toast={notice.toast} onDismiss={notice.dismiss} />

      {savedOpen && (
        <SavedLocations
          homes={saved.homes}
          onClose={() => setSavedOpen(false)}
          onRemove={(entityId) => {
            saved.remove(entityId)
            notice.show('Removed.')
          }}
          onClear={() => {
            const restore = saved.clear()
            setSavedOpen(false)
            notice.show('Saved places cleared.', restore)
          }}
        />
      )}

      {open && openEvidence && result && (
        <Detail
          entity={open}
          evidence={openEvidence}
          result={result}
          saved={saved.isSaved(open.entity_id)}
          onSave={() => saved.toggle(open)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

/** Says what is happening now, in the same words the plan used. */
function describe(events: AskEvent[]): string {
  const last = events[events.length - 1]
  if (!last) return 'Reading your requirements'
  if (last.kind === 'parsed')
    return `Understood ${last.constraint_set.constraints.length} requirements`
  if (last.kind === 'planned') return 'Working out the cheapest order to check them'
  if (last.kind === 'accepted') return 'Checking'
  if (last.kind === 'stage') return `${last.entities_out} still standing`
  return 'Checking'
}
