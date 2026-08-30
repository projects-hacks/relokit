import type { Standing } from '@relokit/evidence'
import type { Constraint, EvidenceRow, Place } from '@relokit/schema'
import { described } from '../lib/attributes.ts'
import { ago, money, sourceName, tight } from '../lib/format.ts'
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
  siblings,
  standing,
  evidence,
  constraints,
  blocking,
  prominent,
  saved,
  selected,
  hovered,
  onSave,
  onSelect,
  onHover,
  onOpen,
  onOpenSibling,
}: {
  entity: Place
  /** The building's other units, folded under this card. */
  siblings?: Place[]
  standing?: Standing
  evidence: EvidenceRow[]
  constraints: Constraint[]
  blocking?: string[]
  prominent?: boolean
  saved?: boolean
  selected?: boolean
  hovered?: boolean
  onSave?: () => void
  onSelect?: () => void
  onHover?: (over: boolean) => void
  onOpen?: () => void
  onOpenSibling?: (entityId: string) => void
}) {
  const said = new Map(constraints.map((c) => [c.id, c.source_text]))
  const ordered = [...evidence].sort((a, b) => (a.constraint_id < b.constraint_id ? -1 : 1))
  const reason = reasonFor(ordered, blocking)
  const price = money(entity.price_cents)
  const saveButton = onSave && (
    <button
      className="pin"
      data-saved={String(Boolean(saved))}
      title={saved ? 'Remove saved location' : 'Save this location'}
      onClick={(event) => {
        event.stopPropagation()
        onSave()
      }}
      aria-label={saved ? 'Remove saved location' : `Save ${entity.title}`}
    >
      {saved ? '★' : '☆'}
    </button>
  )

  return (
    <article
      className="finding"
      data-prominent={String(Boolean(prominent))}
      data-selected={String(Boolean(selected))}
      data-hovered={String(Boolean(hovered))}
      data-entity={entity.entity_id}
      onClick={onSelect}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
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
          {saveButton}
        </div>
      )}

      <header className="finding-head">
        {/* The title is the way to this home on the map. A card that only
            answers a click leaves the whole flow out of reach of a keyboard,
            and wrapping the card itself would nest the save and open buttons
            inside a control. */}
        <h3 className="finding-title">
          <button
            className="as-link title"
            onClick={(event) => {
              event.stopPropagation()
              onSelect?.()
            }}
            aria-pressed={Boolean(selected)}
          >
            {entity.title}
          </button>
        </h3>
        {price && <span className="finding-price">{price}</span>}
        {!entity.photo_url && saveButton && <span className="pin-inline">{saveButton}</span>}
      </header>

      {described(entity).length > 0 && <p className="traits">{described(entity).join(' · ')}</p>}

      {siblings && siblings.length > 0 && (
        <div className="units">
          <span>Also in this building:</span>
          {siblings.map((unit) => (
            <button
              key={unit.entity_id}
              onClick={(event) => {
                event.stopPropagation()
                onOpenSibling?.(unit.entity_id)
              }}
            >
              {unitLabel(unit)}
            </button>
          ))}
        </div>
      )}

      {standing?.status === 'efficient' && (
        <span className="standing" data-kind="efficient">
          nothing beats it
        </span>
      )}
      {standing?.beaten_by && (
        <span className="standing" data-kind="beaten">
          {standing.beaten_by.title.split(',')[0]} is {standing.beaten_by.on.join(' and ')}
        </span>
      )}

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
              {tight(row.display_value)}
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

/** "2 bed · $3,100", or whatever of that the source stated. */
function unitLabel(unit: Place): string {
  const beds = typeof unit.attributes.beds === 'number' ? `${unit.attributes.beds} bed` : null
  return [beds, money(unit.price_cents)].filter(Boolean).join(' · ') || unit.title.slice(0, 24)
}
