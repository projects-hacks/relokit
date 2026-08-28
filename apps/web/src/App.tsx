import { useMemo } from 'react'
import { plan } from '@relokit/planner'
import { CostTrace } from './plan/CostTrace.tsx'
import { PlanTrace } from './plan/PlanTrace.tsx'
import { Map } from './map/Map.tsx'
import { DEMO_INPUT } from './demo.ts'

export function App() {
  const result = useMemo(() => plan(DEMO_INPUT), [])

  return (
    <div className="app">
      <header>
        <h1>Relokit</h1>
        <p className="query">{DEMO_INPUT.constraints.raw_query}</p>
      </header>

      <main>
        <div className="left">
          <PlanTrace result={result} />
          <CostTrace trace={result.trace} />
        </div>
        <div className="right">
          <Map result={result} />
          <section className="panel">
            <h2>Results</h2>
            <p className="muted">
              Three buckets land here on Sunday: verified, unverified, and rejected with the reason.
              Nothing is shown yet because nothing has been fetched yet.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
