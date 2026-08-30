import type { AskResult } from '@relokit/client'

/**
 * What the answer cost. Lives inside the working, because that is what it is:
 * the arithmetic of the run, not a property of any bucket.
 */
export function Ledger({ result }: { result: AskResult }) {
  const naive = result.cost.naive_units
  const pushdown = result.plan.trace.pushdown_only_cost_units
  const planned = result.cost.planned_units

  return (
    <div className="footnote">
      <p className="eyebrow">What this took</p>
      <dl className="tally">
        <div>
          <dt>Every requirement, one listing at a time</dt>
          <dd>{naive.toLocaleString()}</dd>
        </div>
        <div>
          <dt>With the provider’s own filters, nothing else</dt>
          <dd>{pushdown.toLocaleString()}</dd>
        </div>
        <div data-emphasis="true">
          <dt>Asking each source only what it can settle</dt>
          <dd>{planned.toLocaleString()}</dd>
        </div>
      </dl>
      <p className="ratio">
        <b>{Math.round(naive / Math.max(1, planned))}×</b> fewer searches than checking every
        requirement against every listing
      </p>
      <p className="note">
        {result.cost.actual_units === 0
          ? `None were spent this time. ${result.cost.cache_hits} answers had already been fetched${
              result.cost.ledger_hits > 0
                ? ` and ${result.cost.ledger_hits} were already known from an earlier question`
                : ''
            }.`
          : `${result.cost.actual_units} spent, ${result.cost.cache_hits} already fetched, ${result.cost.ledger_hits} already known.`}
      </p>
    </div>
  )
}
