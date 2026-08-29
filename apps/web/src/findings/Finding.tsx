import type { Constraint, EvidenceRow, ListingSummary } from '@relokit/schema'

const MARK: Record<string, string> = { pass: '✓', fail: '✕', unknown: '?' }

/**
 * A marked up survey line. The verdict sits in the margin, the fact reads
 * plainly, and where it came from and how old it is sit beside it rather than
 * behind a hover. That last part is the whole argument: a judge will zoom into
 * one of these before believing any of it.
 */
export function Finding({
  entity,
  evidence,
  constraints,
  blocking,
}: {
  entity: ListingSummary
  evidence: EvidenceRow[]
  constraints: Constraint[]
  blocking?: string[]
}) {
  const said = new Map(constraints.map((c) => [c.id, c.source_text]))
  const ordered = [...evidence].sort((a, b) => (a.constraint_id < b.constraint_id ? -1 : 1))

  return (
    <article className="finding">
      <header className="finding-head">
        <h3 className="finding-title">{entity.title}</h3>
        {entity.price_cents !== null && (
          <span className="finding-price">
            ${Math.round(entity.price_cents / 100).toLocaleString()}
          </span>
        )}
      </header>

      <div className="checks">
        {ordered.map((row) => (
          <div
            className="check"
            key={row.constraint_id}
            style={{ '--mark': markColour(row) } as React.CSSProperties}
          >
            <span className="check-mark" aria-hidden="true">
              {MARK[row.verdict]}
            </span>
            <span className="check-fact">
              {row.display_value}
              <span className="check-said">{said.get(row.constraint_id)}</span>
            </span>
            <span className="provenance" data-stale={String(isStale(row))}>
              {sourceName(row.source)}
              <br />
              {age(row.fetched_at_ms)}
            </span>
          </div>
        ))}
      </div>

      {reasonFor(ordered, blocking) && <p className="reason">{reasonFor(ordered, blocking)}</p>}
    </article>
  )
}

function markColour(row: EvidenceRow): string {
  if (row.verdict === 'pass') return 'var(--verified)'
  if (row.verdict === 'fail') return 'var(--ruled-out)'
  return 'var(--unsure)'
}

/** Named the way a person would say it, not the way the registry stores it. */
function sourceName(source: string): string {
  const names: Record<string, string> = {
    zillow: 'Zillow',
    google_maps: 'Google Maps',
    google_maps_directions: 'Directions',
    google_local: 'Google',
    google_maps_reviews: 'Reviews',
    google_news: 'Google News',
    yelp: 'Yelp',
  }
  return names[source] ?? source
}

function age(fetchedAtMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - fetchedAtMs) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function isStale(row: EvidenceRow): boolean {
  return row.expires_at_ms < Date.now()
}

/**
 * Only shown when the checks above do not already say it. A home ruled out at
 * 42 minutes against a 25 minute limit explains itself; one held back because
 * the measurement came from the middle of a neighbourhood does not.
 */
function reasonFor(evidence: EvidenceRow[], blocking: string[] | undefined): string | null {
  if (!blocking?.length) return null
  const first = evidence.find((row) => blocking.includes(row.constraint_id))
  if (first?.reason) return first.reason
  if (first && first.verdict !== 'fail' && first.eval_state !== 'evaluated') {
    return 'Nothing could be established about this one, so it is neither ruled in nor out.'
  }
  return null
}
