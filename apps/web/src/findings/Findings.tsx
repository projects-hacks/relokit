import { useState } from 'react'
import type { AskResult } from '@relokit/client'
import { Finding } from './Finding.tsx'

type Bucket = 'verified' | 'unsure' | 'out'

/**
 * Three buckets, never two.
 *
 * "Couldn't verify" is its own answer and not a soft rejection. Folding it into
 * either neighbour would be the interface telling a story the evidence does not
 * support.
 */
export function Findings({ result }: { result: AskResult }) {
  const [open, setOpen] = useState<Bucket>('verified')
  const { results, unverified, rejections } = result.buckets
  const entity = (id: string) => result.entities.find((e) => e.entity_id === id)!
  const constraints = result.constraint_set.constraints

  const tabs: { id: Bucket; label: string; count: number; mark: string }[] = [
    { id: 'verified', label: 'Verified', count: results.length, mark: 'var(--verified)' },
    { id: 'unsure', label: 'Couldn’t verify', count: unverified.length, mark: 'var(--unsure)' },
    { id: 'out', label: 'Ruled out', count: rejections.length, mark: 'var(--ruled-out)' },
  ]

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
        {open === 'verified' &&
          (results.length === 0 ? (
            <p className="note">
              Nothing cleared every requirement. What would take the fewest changes is below.
            </p>
          ) : (
            results.map((entry) => (
              <div
                key={entry.entity_id}
                style={{ '--mark': 'var(--verified)' } as React.CSSProperties}
              >
                <Finding
                  entity={entity(entry.entity_id)}
                  evidence={entry.evidence}
                  constraints={constraints}
                />
              </div>
            ))
          ))}

        {open === 'unsure' &&
          unverified.map((entry) => (
            <div key={entry.entity_id} style={{ '--mark': 'var(--unsure)' } as React.CSSProperties}>
              <Finding
                entity={entity(entry.entity_id)}
                evidence={entry.evidence}
                constraints={constraints}
                blocking={entry.unknown_constraint_ids}
              />
            </div>
          ))}

        {open === 'out' &&
          rejections.map((entry) => (
            <div
              key={entry.entity_id}
              style={{ '--mark': 'var(--ruled-out)' } as React.CSSProperties}
            >
              <Finding
                entity={entity(entry.entity_id)}
                evidence={entry.evidence}
                constraints={constraints}
                blocking={entry.failed_constraint_ids}
              />
            </div>
          ))}
      </div>
    </>
  )
}
