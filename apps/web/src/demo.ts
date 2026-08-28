import { ConstraintSet, Registry, type PlanInput } from '@relokit/schema'
import query from '../../../fixtures/queries/relocation-san-jose.json'
import seed from '../../../xano/registry.seed.json'

/**
 * Stands in for POST /parse until Xano is live. The office point is the one the
 * geocode fixture actually returned, so the box and the clusters on screen are
 * the real ones rather than a sketch.
 */
const OFFICE = { lat: 37.3726799, lng: -121.9678625 }

const registry = Registry.parse(seed)

const constraints = ConstraintSet.parse({
  ...query,
  constraints: query.constraints.map((c) =>
    c.type === 'commute' ? { ...c, destination: { ...c.destination, point: OFFICE } } : c,
  ),
})

export const DEMO_INPUT: PlanInput = {
  constraints,
  registry: registry.capabilities,
  registry_version: registry.registry_version,
  budget: { max_cost_units: 200, max_stages: 6, cluster_count: 12, overshoot_factor: 1.3 },
  now_ms: 1756400000000,
}
