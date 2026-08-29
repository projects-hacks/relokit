import { useEffect } from 'react'
import type { AskResult } from '@relokit/client'
import type { EvidenceRow, ListingSummary } from '@relokit/schema'
import { ago, money, sourceName } from '../lib/format.ts'

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
  entity: ListingSummary
  evidence: EvidenceRow[]
  result: AskResult
  saved: boolean
  onSave: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    addEventListener('keydown', escape)
    return () => removeEventListener('keydown', escape)
  }, [onClose])

  const said = new Map(result.constraint_set.constraints.map((c) => [c.id, c.source_text]))
  const photos =
    entity.photos.length > 0 ? entity.photos : entity.photo_url ? [entity.photo_url] : []
  const price = money(entity.price_cents)

  return (
    <div className="detail-scrim" onClick={onClose}>
      <aside
        className="detail"
        role="dialog"
        aria-label={entity.title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="detail-head">
          <div>
            <h2>{entity.title}</h2>
            <p className="note">
              {[
                price,
                entity.beds !== null && `${entity.beds} bed`,
                entity.baths !== null && `${entity.baths} bath`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {photos.length > 0 && (
          <div className="gallery">
            {photos.map((photo) => (
              <img key={photo} src={photo} alt="" loading="lazy" decoding="async" />
            ))}
          </div>
        )}

        <div className="detail-actions">
          <button className={saved ? 'saved' : 'save'} onClick={onSave}>
            {saved ? 'Saved' : 'Save this one'}
          </button>
          {entity.url && (
            <a className="outward" href={entity.url} target="_blank" rel="noreferrer">
              See it on Zillow
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
                  {row.display_value}
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
    </div>
  )
}

function mark(row: EvidenceRow): string {
  if (row.verdict === 'pass') return 'var(--verified)'
  if (row.verdict === 'fail') return 'var(--ruled-out)'
  return 'var(--unsure)'
}
