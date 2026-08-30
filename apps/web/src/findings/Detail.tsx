import { createPortal } from 'react-dom'
import type { AskResult } from '@relokit/client'
import type { EvidenceRow, Place } from '@relokit/schema'
import { ago, money, sourceName, tight } from '../lib/format.ts'
import { useDialog } from '../lib/dialog.ts'
import { described } from '../lib/attributes.ts'

const MARK: Record<string, string> = { pass: '✓', fail: '✕', unknown: '?' }

/**
 * One home, at length.
 *
 * The card is enough to choose between homes; this is enough to decide on one.
 * Every fact carries a link to the place that answered it, because the point of
 * checking against the source is that the reader can go and look.
 */
export function Detail({
  entity,
  evidence,
  result,
  saved,
  onSave,
  onClose,
}: {
  entity: Place
  evidence: EvidenceRow[]
  result: AskResult
  saved: boolean
  onSave: () => void
  onClose: () => void
}) {
  const dialog = useDialog<HTMLElement>(onClose)

  const said = new Map(result.constraint_set.constraints.map((c) => [c.id, c.source_text]))
  const photos =
    entity.photos.length > 0 ? entity.photos : entity.photo_url ? [entity.photo_url] : []
  const price = money(entity.price_cents)

  // Rendered outside the application root so the root itself can be made
  // inert while this is open. A dialog nested inside what it disables would
  // disable itself.
  return createPortal(
    <div className="detail-scrim" onClick={onClose}>
      <aside
        className="detail"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={entity.title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="detail-head">
          <div>
            <h2>{entity.title}</h2>
            <p className="note">{[price, ...described(entity)].filter(Boolean).join(' · ')}</p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {photos.length > 0 && (
          <div className="gallery">
            {photos.map((photo) => (
              <img
                key={photo}
                src={photo}
                alt=""
                width={560}
                height={340}
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>
        )}

        {/* places:<id> is Google's own place id, so their link opens the exact
            listing rather than a search for its name. */}
        <div className="detail-actions">
          <button className={saved ? 'saved' : 'save'} onClick={onSave}>
            {saved ? 'Saved' : 'Save this place'}
          </button>
          {entity.url && (
            <a className="outward" href={entity.url} target="_blank" rel="noreferrer">
              {result.constraint_set.subject === 'rental' ||
              result.constraint_set.subject === 'home_for_sale'
                ? 'See the full listing'
                : 'Visit the website'}
            </a>
          )}
          {entity.point && (
            <a
              className="outward"
              href={
                entity.entity_id.startsWith('places:')
                  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entity.title)}&query_place_id=${entity.entity_id.slice('places:'.length)}`
                  : `https://www.google.com/maps/search/?api=1&query=${entity.point.lat},${entity.point.lng}`
              }
              target="_blank"
              rel="noreferrer"
            >
              Google Maps
            </a>
          )}
          {entity.point && (
            <a
              className="outward"
              href={`https://maps.apple.com/?q=${encodeURIComponent(entity.title)}&ll=${entity.point.lat},${entity.point.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Apple Maps
            </a>
          )}
        </div>

        <p className="eyebrow">What was checked</p>
        <div className="checks">
          {[...evidence]
            .sort((a, b) => (a.constraint_id < b.constraint_id ? -1 : 1))
            .map((row) => (
              <div
                className="check"
                key={row.constraint_id}
                style={{ '--mark': mark(row) } as React.CSSProperties}
              >
                <span className="check-mark">{MARK[row.verdict]}</span>
                <span className="check-fact">
                  {tight(row.display_value)}
                  <span className="check-said">{said.get(row.constraint_id)}</span>
                  {row.reason && <span className="check-said">{row.reason}</span>}
                </span>
                <span className="provenance">
                  {row.source_url ? (
                    <a href={row.source_url} target="_blank" rel="noreferrer">
                      {sourceName(row.source)} ↗
                    </a>
                  ) : (
                    sourceName(row.source)
                  )}
                  <br />
                  {ago(row.fetched_at_ms)}
                </span>
              </div>
            ))}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function mark(row: EvidenceRow): string {
  if (row.verdict === 'pass') return 'var(--verified)'
  if (row.verdict === 'fail') return 'var(--ruled-out)'
  return 'var(--unsure)'
}
