import type { Constraint, EvidenceRow, ListingSummary } from '@relokit/schema'
import { ago, money, sourceName } from '../lib/format.ts'
import { Tip } from '../lib/tooltip.tsx'

const MARK: Record<string, string> = { pass: '✓', fail: '✕', unknown: '?' }

const EXPLAIN: Record<string, string> = {
  pass: 'Checked against the source that holds it, and it holds.',
  fail: 'Checked against the source that holds it, and it does not.',
  unknown: 'Asked, but the source could not settle it. Not counted either way.',
}

/**
 * A home, then the case for it.
 *
 * The photograph comes first because that is how anyone actually looks at a
 * place. Underneath it the same survey line as before: a verdict in the margin,
 * the fact in plain words, and where it came from and how old it is beside it
 * rather than behind a hover. The picture invites; the margin is what earns
 * belief.
 */
export function Finding({
  entity,
  evidence,
  constraints,
  blocking,
  prominent,
  saved,
  selected,
  onSave,
  onSelect,
  onOpen,
}: {
  entity: ListingSummary
  evidence: EvidenceRow[]
  constraints: Constraint[]
  blocking?: string[]
  prominent?: boolean
  saved?: boolean
  selected?: boolean
  onSave?: () => void
  onSelect?: () => void
  onOpen?: () => void
}) {
  const said = new Map(constraints.map((c) => [c.id, c.source_text]))
  const ordered = [...evidence].sort((a, b) => (a.constraint_id < b.constraint_id ? -1 : 1))
  const reason = reasonFor(ordered, blocking)
  const price = money(entity.price_cents)

  return (
    <article
      className="finding"
      data-prominent={String(Boolean(prominent))}
      data-selected={String(Boolean(selected))}
      onClick={onSelect}
    >
      {entity.photo_url && (
        <div className="shot">
          <img
            src={entity.photo_url}
            alt=""
            width={640}
            height={360}
            loading="lazy"
            decoding="async"
          />
          {entity.photos.length > 1 && <span className="shot-count">{entity.photos.length}</span>}
          {onSave && (
            <Tip
              text={saved ? 'Remove from your shortlist' : 'Keep this one to come back to'}
              side="left"
            >
              <button
                className="pin"
                data-saved={String(Boolean(saved))}
                // Keeping a home should not also fly the map to it. Without
                // this the click reaches the card behind and does both.
                onClick={(event) => {
                  event.stopPropagation()
                  onSave()
                }}
                aria-label={saved ? 'Saved' : 'Save this home'}
              >
                {saved ? '★' : '☆'}
              </button>
            </Tip>
          )}
        </div>
      )}

      <header className="finding-head">
        <h3 className="finding-title">{entity.title}</h3>
        {price && <span className="finding-price">{price}</span>}
      </header>

      <button
        className="as-link open"
        onClick={(event) => {
          event.stopPropagation()
          onOpen?.()
        }}
      >
        Photos and everything checked
      </button>

      <div className="checks">
        {ordered.map((row) => (
          <div
            className="check"
            key={row.constraint_id}
            style={{ '--mark': markColour(row) } as React.CSSProperties}
          >
            <Tip text={EXPLAIN[row.verdict] ?? ''} side="right">
              <span className="check-mark" aria-label={row.verdict}>
                {MARK[row.verdict]}
              </span>
            </Tip>
            <span className="check-fact">
              {row.display_value}
              <span className="check-said">{said.get(row.constraint_id)}</span>
            </span>
            <Tip
              text={`${sourceName(row.source)} answered this ${ago(row.fetched_at_ms)}. It stays good for ${Math.round(row.ttl_seconds / 3600)} hours.`}
              side="left"
            >
              <span className="provenance" data-stale={String(row.expires_at_ms < Date.now())}>
                {sourceName(row.source)}
                <br />
                {ago(row.fetched_at_ms)}
              </span>
            </Tip>
          </div>
        ))}
      </div>

      {reason && <p className="reason">{reason}</p>}
    </article>
  )
}

function markColour(row: EvidenceRow): string {
  if (row.verdict === 'pass') return 'var(--verified)'
  if (row.verdict === 'fail') return 'var(--ruled-out)'
  return 'var(--unsure)'
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
