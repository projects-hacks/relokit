import { NO_FILTERS, type Filters, type SortKey } from '@relokit/evidence'
import type { ConstraintSet } from '@relokit/schema'

const ORDER_LABEL: Record<SortKey, string> = {
  rated: 'Top rated first',
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
  priced,
  bedded,
  rated,
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
  /** Which filters mean anything for what was searched. A rent ceiling over
   * restaurants and a bedroom count over gyms are dials wired to nothing. */
  priced: boolean
  bedded: boolean
  rated: boolean
  showing: number
  word: { one: string; many: string }
  total: number
}) {
  const budget = constraints.find((c) => c.type === 'budget')
  const asked = budget?.type === 'budget' ? budget.max_cents : undefined
  const beds = constraints.find((c) => c.type === 'unit_attribute' && c.attribute === 'beds')
  const askedBeds = beds?.type === 'unit_attribute' ? (beds.min ?? beds.max) : undefined
  const touched =
    filters.max_price_cents !== null ||
    filters.beds !== null ||
    filters.min_rating !== null ||
    filters.q !== ''

  return (
    <div className="controls">
      <label className="control control-q">
        <span>Find in results</span>
        <input
          type="search"
          placeholder="name or address"
          value={filters.q}
          onChange={(event) => onFilters({ ...filters, q: event.target.value })}
        />
      </label>

      {sorts.length > 0 && (
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
      )}

      {priced && (
        <label className="control">
          {/* Only somewhere you live has rent. A list of restaurants under a
              box marked "Rent up to" reads as the wrong product. */}
          <span>{bedded ? 'Rent up to' : 'Price up to'}</span>
          <input
            type="number"
            inputMode="numeric"
            step={100}
            min={0}
            placeholder={asked ? String(Math.round(asked / 100)) : 'any'}
            value={
              filters.max_price_cents === null ? '' : Math.round(filters.max_price_cents / 100)
            }
            onChange={(event) =>
              onFilters({
                ...filters,
                max_price_cents:
                  event.target.value === '' ? null : Number(event.target.value) * 100,
              })
            }
          />
        </label>
      )}

      {bedded && (
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
      )}

      {rated && (
        <label className="control">
          <span>Rating at least</span>
          <select
            value={filters.min_rating === null ? '' : String(filters.min_rating)}
            onChange={(event) =>
              onFilters({
                ...filters,
                min_rating: event.target.value === '' ? null : Number(event.target.value),
              })
            }
          >
            <option value="">any</option>
            {[3.5, 4, 4.5].map((floor) => (
              <option key={floor} value={floor}>
                {floor}+
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="showing" aria-live="polite">
        {showing === total
          ? `${total} ${total === 1 ? word.one : word.many}`
          : `${showing} of ${total}`}
        {touched && (
          <button className="as-link" onClick={() => onFilters(NO_FILTERS)}>
            clear
          </button>
        )}
      </p>
    </div>
  )
}
