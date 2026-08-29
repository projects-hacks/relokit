import type { AskResult } from '@relokit/client'

/**
 * What the answer cost.
 *
 * Three numbers rather than a ratio, because the middle one is the honest part:
 * what the provider's own filters would have saved anyway, before any of this
 * decided anything. The bars are gone because at this spread they cannot be
 * read: eighty one against thirteen thousand is a sliver, and a sliver argues
 * nothing. The numbers argue on their own.
 */
export function Ledger({ result }: { result: AskResult }) {
  const naive = result.cost.naive_units
  const pushdown = result.plan.trace.pushdown_only_cost_units
  const planned = result.cost.planned_units

  return (
    <section>
      <p className="eyebrow">What it cost</p>
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
        <b>{Math.round(naive / Math.max(1, planned))}×</b> fewer searches
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
    </section>
  )
}
