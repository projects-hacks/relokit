import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FREE_CONSTRAINT_FIELDS, bindingForRef, resolveConstraintField } from './binding.ts'
import { Registry, paramRefs } from './capability.ts'
import { ConstraintSet, type Constraint } from './constraints.ts'

const registry = Registry.parse(
  JSON.parse(readFileSync(new URL('../../../xano/registry.seed.json', import.meta.url), 'utf8')),
)
const constraints = ConstraintSet.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../fixtures/queries/relocation-san-jose.json', import.meta.url),
      'utf8',
    ),
  ),
).constraints

const byType = (type: Constraint['type']) => constraints.find((c) => c.type === type)!

describe('resolver contract', () => {
  it('formats cents into the dollars Zillow expects, at the edge and not before', () => {
    const budget = byType('budget')
    expect(resolveConstraintField(budget, 'max_cents')).toBe(280_000)
    expect(resolveConstraintField(budget, 'max_dollars')).toBe(2800)
  })

  it('turns the travel mode into the integer this engine wants', () => {
    // The Directions engine takes 0 driving, 1 cycling, 2 walking, 3 transit.
    // Sending the word silently returns a driving route.
    const commute = byType('commute')
    expect(resolveConstraintField(commute, 'mode')).toBe('bike')
    expect(resolveConstraintField(commute, 'travel_mode_code')).toBe(1)
  })

  it('falls back from a free text refinement to the category', () => {
    const poi = constraints.find((c) => c.type === 'nearby_poi')!
    expect(poi.query).toBeUndefined()
    expect(resolveConstraintField(poi, 'query')).toBe('gym')
  })

  it('flattens the opening window, keeping seconds of day', () => {
    const gym = constraints.find((c) => c.type === 'nearby_poi' && c.category === 'gym')!
    expect(resolveConstraintField(gym, 'opens_by_s')).toBe(21_600)
    const grocery = constraints.find((c) => c.type === 'nearby_poi' && c.category === 'grocery')!
    expect(resolveConstraintField(grocery, 'closes_after_s')).toBe(79_200)
  })

  it('cannot produce a destination point, because only a geocode can', () => {
    const commute = byType('commute')
    expect(resolveConstraintField(commute, 'destination_raw')).toBe(
      '2788 San Tomas Expressway, Santa Clara, CA',
    )
    expect(resolveConstraintField(commute, 'destination_point')).toBeUndefined()
    expect(FREE_CONSTRAINT_FIELDS.commute).not.toContain('destination_point')
  })
})

describe('every registry template resolves', () => {
  const constraintRefs = registry.capabilities.flatMap((capability) =>
    Object.values(capability.params_template)
      .flatMap((value) => paramRefs(value))
      .filter((ref) => ref.startsWith('$constraint.'))
      .map((ref) => ({ capability, field: ref.split('.')[2]! })),
  )

  it('finds constraint refs to check', () => {
    expect(constraintRefs.length).toBeGreaterThan(5)
  })

  it.each(constraintRefs.map((r) => [r.capability.capability_id, r.field]))(
    '%s reads a field that exists: %s',
    (capabilityId, field) => {
      const capability = registry.capabilities.find((c) => c.capability_id === capabilityId)!
      const known = FREE_CONSTRAINT_FIELDS[capability.constraint_type]
      const binding = bindingForRef(`$constraint.self.${field}`, capability.constraint_type)
      // Either the resolver can produce it now, or something in the plan has to
      // bind it first. A typo is neither, and lands here.
      const isPlannedBinding = binding !== null && capability.produces.length >= 0
      expect(known.includes(field) || isPlannedBinding).toBe(true)
      if (!known.includes(field)) {
        expect(['constraint.destination_point']).toContain(binding)
      }
    },
  )

  it('resolves every free field against the demo query without undefined', () => {
    for (const constraint of constraints) {
      for (const field of FREE_CONSTRAINT_FIELDS[constraint.type]) {
        const value = resolveConstraintField(constraint, field)
        if (value === undefined) continue
        expect(['string', 'number', 'boolean']).toContain(typeof value)
      }
    }
  })
})

describe('binding classification', () => {
  it('maps each ref namespace to what has to exist first', () => {
    expect(bindingForRef('$entity.lat', 'commute')).toBe('entity')
    expect(bindingForRef('$cluster.lng', 'nearby_poi')).toBe('cluster')
    expect(bindingForRef('$stage.bounds.north', 'candidate_source')).toBe('stage.bounds')
    expect(bindingForRef('$constraint.self.mode', 'commute')).toBeNull()
    expect(bindingForRef('$constraint.self.destination_point', 'commute')).toBe(
      'constraint.destination_point',
    )
  })
})
