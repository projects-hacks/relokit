import { useMemo, useState } from 'react'
import type { AskResult } from '@relokit/client'
import {
  NO_FILTERS,
  availableSorts,
  filterEntries,
  sortEntries,
  type Filters,
  type SortKey,
} from '@relokit/evidence'
import type { ListingSummary } from '@relokit/schema'
import { Controls } from './Controls.tsx'
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
  onSelect,
  selected,
}: {
  result: AskResult
  isSaved: (entityId: string) => boolean
  onSave: (entity: ListingSummary) => void
  onOpen: (entityId: string) => void
  onSelect: (entityId: string) => void
  selected: string | null
}) {
  const [open, setOpen] = useState<Bucket>('verified')
  const [sort, setSort] = useState<SortKey>('best')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const { results, unverified, rejections } = result.buckets
  // A bucket entry naming a listing that never arrived is a bug somewhere else,
  // and it should not take the whole page down with it.
  const entity = (id: string) => result.entities.find((e) => e.entity_id === id)
  const constraints = result.constraint_set.constraints

  // Nothing was verified if nothing was asked. A question that is only a place
  // returns homes, and calling them verified claims a check that never happened.
  const asked = constraints.some((constraint) => constraint.hardness === 'hard')

  const tabs: { id: Bucket; label: string; count: number; mark: string }[] = [
    {
      id: 'verified',
      label: asked ? 'Verified' : 'Found',
      count: results.length,
      mark: 'var(--verified)',
    },
    {
      id: 'unsure',
      label: 'Couldn\u2019t verify',
      count: unverified.length,
      mark: 'var(--unsure)',
    },
    { id: 'out', label: 'Ruled out', count: rejections.length, mark: 'var(--ruled-out)' },
  ]

  const bucket =
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

  const sorts = useMemo(
    () =>
      availableSorts(
        bucket.map((row) => row.entry),
        open === 'verified' && asked,
      ),
    [bucket, open, asked],
  )

  const active = sorts.includes(sort) ? sort : sorts[0]!

  const shown = useMemo(() => {
    const rows = new Map(bucket.map((row) => [row.entry.entity_id, row]))
    const kept = filterEntries(
      bucket.map((row) => row.entry),
      result.entities,
      filters,
    )
    return sortEntries(kept, result.entities, active).map((entry) => rows.get(entry.entity_id)!)
  }, [bucket, result.entities, filters, active])

  const shownTabs = asked ? tabs : tabs.filter((tab) => tab.count > 0)

  return (
    <>
      <div className="bucket-tabs" role="tablist">
        {shownTabs.map((tab) => (
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

      {bucket.length > 0 && (
        <Controls
          sorts={sorts}
          sort={active}
          onSort={setSort}
          filters={filters}
          onFilters={setFilters}
          constraints={constraints}
          showing={shown.length}
          total={bucket.length}
        />
      )}

      {/* The gap lives on the list. An adjacent-sibling rule cannot work here,
          because every card is wrapped and no two are ever siblings. */}
      <div className="finding-list">
        {shown.length === 0 ? (
          <p className="note">
            {bucket.length > 0
              ? 'Nothing here matches what you narrowed to. Widen it above.'
              : open === 'verified'
                ? 'Nothing cleared every requirement. What would take the fewest changes is below.'
                : open === 'unsure'
                  ? 'Everything that was checked could be settled one way or the other.'
                  : 'Nothing was ruled out.'}
          </p>
        ) : (
          shown.map(({ entry, blocking, mark }) => {
            const home = entity(entry.entity_id)
            if (!home) return null
            return (
              <div key={entry.entity_id} style={{ '--mark': mark } as React.CSSProperties}>
                <Finding
                  entity={home}
                  evidence={entry.evidence}
                  constraints={constraints}
                  blocking={blocking}
                  prominent={open === 'verified'}
                  saved={isSaved(home.entity_id)}
                  selected={selected === home.entity_id}
                  onSave={() => onSave(home)}
                  onSelect={() => onSelect(home.entity_id)}
                  onOpen={() => onOpen(home.entity_id)}
                />
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
