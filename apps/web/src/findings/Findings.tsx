import { useMemo, useState } from 'react'
import type { AskResult } from '@relokit/client'
import {
  NO_FILTERS,
  availableSorts,
  filterEntries,
  frontier,
  groupSiblings,
  sortEntries,
  type Filters,
  type SortKey,
} from '@relokit/evidence'
import { SUBJECT_WORDS, type Place } from '@relokit/schema'
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
  onHover,
  selected,
  hovered,
}: {
  result: AskResult
  isSaved: (entityId: string) => boolean
  onSave: (entity: Place) => void
  onOpen: (entityId: string) => void
  onSelect: (entityId: string) => void
  onHover: (entityId: string | null) => void
  selected: string | null
  hovered: string | null
}) {
  const [open, setOpen] = useState<Bucket>('verified')
  // A question about being near somewhere reads most naturally nearest first;
  // anything else starts from what clears the limits best.
  const [sort, setSort] = useState<SortKey>(() =>
    result.constraint_set.constraints.some((c) => c.type === 'proximity') &&
    !result.constraint_set.constraints.some((c) => c.type === 'commute')
      ? 'nearest'
      : 'best',
  )
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const { results, unverified, rejections } = result.buckets
  // A bucket entry naming a listing that never arrived is a bug somewhere else,
  // and it should not take the whole page down with it.
  const entity = (id: string) => result.entities.find((e) => e.entity_id === id)
  const constraints = result.constraint_set.constraints

  // Verified means something was actually established, so the test is whether
  // any fact was settled rather than whether a requirement was marked hard. A
  // question that is only a place settles nothing and says found; a requirement
  // the provider applied inside its own search is still checked, and calling
  // that merely found contradicts the tick on every card.
  const asked = [...results, ...unverified, ...rejections].some((entry) =>
    entry.evidence.some((row) => row.eval_state === 'evaluated'),
  )

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

  // Which verified results are beaten outright, and by whom. Only the verified
  // bucket: dominance among the rejected is an answer nobody asked for.
  const standings = useMemo(() => frontier(results, result.entities), [results, result.entities])
  const efficient = results.filter(
    (entry) => standings.get(entry.entity_id)?.status === 'efficient',
  ).length

  const sorts = useMemo(
    () =>
      availableSorts(
        bucket.map((row) => row.entry),
        result.entities,
        open === 'verified' && asked,
      ),
    [bucket, open, asked],
  )

  const active = sorts.includes(sort) ? sort : (sorts[0] ?? 'best')

  const shown = useMemo(() => {
    const rows = new Map(bucket.map((row) => [row.entry.entity_id, row]))
    const kept = filterEntries(
      bucket.map((row) => row.entry),
      result.entities,
      filters,
    )
    const ordered = sortEntries(kept, result.entities, active).map((entry) =>
      rows.get(entry.entity_id)!,
    )
    // Under the default order the efficient set leads: what nothing beats is a
    // better first screen than a tie broken by id.
    if (active === 'best' && open === 'verified') {
      return [
        ...ordered.filter((row) => standings.get(row.entry.entity_id)?.status !== 'beaten'),
        ...ordered.filter((row) => standings.get(row.entry.entity_id)?.status === 'beaten'),
      ]
    }
    return ordered
  }, [bucket, result.entities, filters, active, open, standings])

  // One building, one card: a block that arrived as one listing per bedroom
  // count folds under whichever unit the order put first.
  const grouped = useMemo(
    () =>
      groupSiblings(shown.map((row) => row.entry)).map((group) => ({
        row: shown.find((candidate) => candidate.entry === group.primary)!,
        siblings: group.siblings
          .map((sibling) => entity(sibling.entity_id))
          .filter((sibling): sibling is Place => sibling !== undefined),
      })),
    [shown],
  )

  const shownTabs = asked ? tabs : tabs.filter((tab) => tab.count > 0)

  // Arrow keys move between tabs and only the selected one is a tab stop, so
  // Tab passes over the whole group rather than through every bucket in it.
  const step = (delta: number) => {
    const at = shownTabs.findIndex((tab) => tab.id === open)
    const next = shownTabs[(at + delta + shownTabs.length) % shownTabs.length]
    if (!next) return
    setOpen(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  return (
    <>
      <div className="bucket-tabs" role="tablist" aria-label="What was found">
        {shownTabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-selected={open === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={open === tab.id ? 0 : -1}
            style={{ '--mark': tab.mark } as React.CSSProperties}
            onClick={() => setOpen(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') step(1)
              if (event.key === 'ArrowLeft') step(-1)
            }}
          >
            <b>{tab.count}</b>
            {tab.label}
          </button>
        ))}
      </div>

      {open === 'verified' && efficient > 0 && efficient < results.length && (
        <p className="frontier-note">
          <b>{efficient}</b> of {results.length} are efficient: nothing beats them on every count.
          The rest say who does.
        </p>
      )}

      {bucket.length > 0 && (
        <Controls
          sorts={sorts}
          sort={active}
          onSort={setSort}
          filters={filters}
          onFilters={setFilters}
          constraints={constraints}
          priced={result.entities.some((entity) => entity.price_cents !== null)}
          rated={result.entities.some((entity) => typeof entity.attributes.rating === 'number')}
          bedded={
            result.constraint_set.subject === 'rental' ||
            result.constraint_set.subject === 'home_for_sale'
          }
          showing={shown.length}
          total={bucket.length}
          word={SUBJECT_WORDS[result.constraint_set.subject]}
        />
      )}

      {/* The gap lives on the list. An adjacent-sibling rule cannot work here,
          because every card is wrapped and no two are ever siblings. */}
      <div
        className="finding-list"
        id={`panel-${open}`}
        role="tabpanel"
        aria-labelledby={`tab-${open}`}
      >
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
          grouped.map(({ row: { entry, blocking, mark }, siblings }) => {
            const home = entity(entry.entity_id)
            if (!home) return null
            return (
              <div key={entry.entity_id} style={{ '--mark': mark } as React.CSSProperties}>
                <Finding
                  entity={home}
                  siblings={siblings}
                  standing={open === 'verified' ? standings.get(entry.entity_id) : undefined}
                  evidence={entry.evidence}
                  constraints={constraints}
                  blocking={blocking}
                  prominent={open === 'verified'}
                  saved={isSaved(home.entity_id)}
                  selected={selected === home.entity_id}
                  hovered={hovered === home.entity_id}
                  onSave={() => onSave(home)}
                  onSelect={() => onSelect(home.entity_id)}
                  onHover={(over) => onHover(over ? home.entity_id : null)}
                  onOpen={() => onOpen(home.entity_id)}
                  onOpenSibling={onOpen}
                />
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
