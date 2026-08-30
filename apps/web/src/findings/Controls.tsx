import type { Filters, SortKey } from '@relokit/evidence'
import type { ConstraintSet } from '@relokit/schema'

const ORDER_LABEL: Record<SortKey, string> = {
  best: 'Clears your limits best',
  cheapest: 'Cheapest first',
  quickest: 'Shortest journey',
  nearest: 'Closest to what you asked for',
}

/**
 * Narrowing a list somebody already narrowed once.
 *
 * The filters start where the question left them: a ceiling of the rent that was
 * asked for, a bedroom count that was asked for. Someone who wrote "under
 * $2,800" should not have to type it again to use it.
 */
export function Controls({
  sorts,
  sort,
  onSort,
  filters,
  onFilters,
  constraints,
  showing,
  word,
  total,
}: {
  sorts: SortKey[]
  sort: SortKey
  onSort: (key: SortKey) => void
  filters: Filters
  onFilters: (filters: Filters) => void
  constraints: ConstraintSet['constraints']
  showing: number
  word: { one: string; many: string }
  total: number
}) {
  const budget = constraints.find((c) => c.type === 'budget')
  const asked = budget?.type === 'budget' ? budget.max_cents : undefined
  const beds = constraints.find((c) => c.type === 'unit_attribute' && c.attribute === 'beds')
  const askedBeds = beds?.type === 'unit_attribute' ? (beds.min ?? beds.max) : undefined
  const touched = filters.max_price_cents !== null || filters.beds !== null

  return (
    <div className="controls">
      <label className="control">
        <span>Order</span>
        <select value={sort} onChange={(event) => onSort(event.target.value as SortKey)}>
          {sorts.map((key) => (
            <option key={key} value={key}>
              {ORDER_LABEL[key]}
            </option>
          ))}
        </select>
      </label>

      <label className="control">
        <span>Rent up to</span>
        <input
          type="number"
          inputMode="numeric"
          step={100}
          min={0}
          placeholder={asked ? String(Math.round(asked / 100)) : 'any'}
          value={filters.max_price_cents === null ? '' : Math.round(filters.max_price_cents / 100)}
          onChange={(event) =>
            onFilters({
              ...filters,
              max_price_cents: event.target.value === '' ? null : Number(event.target.value) * 100,
            })
          }
        />
      </label>

      <label className="control">
        <span>Bedrooms</span>
        <select
          value={filters.beds === null ? '' : String(filters.beds)}
          onChange={(event) =>
            onFilters({
              ...filters,
              beds: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        >
          <option value="">any</option>
          {[0, 1, 2, 3, 4].map((count) => (
            <option key={count} value={count}>
              {count === 0 ? 'studio' : count}
              {askedBeds === count ? ' · asked for' : ''}
            </option>
          ))}
        </select>
      </label>

      <p className="showing" aria-live="polite">
        {showing === total
          ? `${total} ${total === 1 ? word.one : word.many}`
          : `${showing} of ${total}`}
        {touched && (
          <button
            className="as-link"
            onClick={() => onFilters({ max_price_cents: null, beds: null })}
          >
            clear
          </button>
        )}
      </p>
    </div>
  )
}
