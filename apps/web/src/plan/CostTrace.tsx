import type { PlanTrace } from '@relokit/schema'

/**
 * Three bars, not one ratio. The middle bar is what separates the planner's
 * contribution from what the provider's own filters would have done anyway.
 */
export function CostTrace({ trace }: { trace: PlanTrace }) {
  const bars = [
    { label: 'every constraint, every listing', value: trace.naive_cost_units },
    { label: 'provider filters only', value: trace.pushdown_only_cost_units },
    { label: 'planned', value: trace.planned_cost_units },
  ]
  const max = Math.max(...bars.map((b) => b.value))

  return (
    <section className="panel cost">
      <h2>Cost</h2>
      {bars.map((bar) => (
        <div className="bar-row" key={bar.label}>
          <span className="bar-label">{bar.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(1, (bar.value / max) * 100)}%` }}
            />
          </span>
          <span className="bar-value">{bar.value.toLocaleString()}</span>
        </div>
      ))}
      <p className="muted">
        Searches, not seconds. Naive means every constraint checked one listing at a time.
      </p>
    </section>
  )
}
