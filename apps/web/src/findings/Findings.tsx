import { useState } from 'react'
import type { AskResult } from '@relokit/client'
import type { ListingSummary } from '@relokit/schema'
import { Finding } from './Finding.tsx'

type Bucket = 'verified' | 'unsure' | 'out'

/**
 * Three buckets, never two.
 *
 * "Couldn't verify" is its own answer and not a soft rejection. Folding it into
 * either neighbour would be the interface telling a story the evidence does not
 * support.
 */
export function Findings({
  result,
  isSaved,
  onSave,
  onOpen,
}: {
  result: AskResult
  isSaved: (entityId: string) => boolean
  onSave: (entity: ListingSummary) => void
  onOpen: (entityId: string) => void
}) {
  const [open, setOpen] = useState<Bucket>('verified')
  const { results, unverified, rejections } = result.buckets
  const entity = (id: string) => result.entities.find((e) => e.entity_id === id)!
  const constraints = result.constraint_set.constraints

  const tabs: { id: Bucket; label: string; count: number; mark: string }[] = [
    { id: 'verified', label: 'Verified', count: results.length, mark: 'var(--verified)' },
    {
      id: 'unsure',
      label: 'Couldn\u2019t verify',
      count: unverified.length,
      mark: 'var(--unsure)',
    },
    { id: 'out', label: 'Ruled out', count: rejections.length, mark: 'var(--ruled-out)' },
  ]

  const shown =
    open === 'verified'
      ? results.map((entry) => ({ entry, blocking: undefined, mark: 'var(--verified)' }))
      : open === 'unsure'
        ? unverified.map((entry) => ({
            entry,
            blocking: entry.unknown_constraint_ids,
            mark: 'var(--unsure)',
          }))
        : rejections.map((entry) => ({
            entry,
            blocking: entry.failed_constraint_ids,
            mark: 'var(--ruled-out)',
          }))

  return (
    <>
      <div className="bucket-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={open === tab.id}
            style={{ '--mark': tab.mark } as React.CSSProperties}
            onClick={() => setOpen(tab.id)}
          >
            <b>{tab.count}</b>
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {shown.length === 0 ? (
          <p className="note">
            {open === 'verified'
              ? 'Nothing cleared every requirement. What would take the fewest changes is below.'
              : open === 'unsure'
                ? 'Everything that was checked could be settled one way or the other.'
                : 'Nothing was ruled out.'}
          </p>
        ) : (
          shown.map(({ entry, blocking, mark }) => (
            <div key={entry.entity_id} style={{ '--mark': mark } as React.CSSProperties}>
              <Finding
                entity={entity(entry.entity_id)}
                evidence={entry.evidence}
                constraints={constraints}
                blocking={blocking}
                prominent={open === 'verified'}
                saved={isSaved(entry.entity_id)}
                onSave={() => onSave(entity(entry.entity_id))}
                onOpen={() => onOpen(entry.entity_id)}
              />
            </div>
          ))
        )}
      </div>
    </>
  )
}
