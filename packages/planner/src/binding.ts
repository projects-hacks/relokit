import {
  BINDING_BOUNDS,
  BINDING_ANCHOR,
  BINDING_CLUSTER,
  BINDING_ENTITY,
  bindingForRef,
  paramRefs,
  type BindingKey,
  type Capability,
  type ConstraintType,
  type Stage,
} from '@relokit/schema'

/**
 * Bindings the planner produces itself rather than buying from a provider.
 *
 * The search box is arithmetic over a destination point, and the cluster grid is
 * arithmetic over the box, but neither exists until its input does. Declaring
 * them here keeps them in the same feasibility check as everything else instead
 * of being enforced by the order the code happens to run in.
 */
export const DERIVED_BINDINGS: Record<BindingKey, BindingKey[][]> = {
  // Either will do. A question naming only a town can still be searched, and a
  // question naming only a place of work is searched around that. Requiring the
  // commute was why "an apartment in Santa Clara" returned nothing at all.
  [BINDING_BOUNDS]: [['constraint.destination_point'], [BINDING_ANCHOR]],
  [BINDING_CLUSTER]: [[BINDING_BOUNDS, BINDING_ENTITY]],
}

/** What a capability needs bound before it can run, read off its own params. */
export function requirementsOf(
  capability: Capability,
  constraintType: ConstraintType,
): BindingKey[] {
  const required = new Set<BindingKey>()
  for (const value of Object.values(capability.params_template)) {
    for (const ref of paramRefs(value)) {
      const binding = bindingForRef(ref, constraintType)
      if (binding) required.add(binding)
    }
  }
  return [...required].sort()
}

export function isFeasible(required: BindingKey[], bound: ReadonlySet<BindingKey>): boolean {
  return required.every((key) => bound.has(key))
}

/**
 * Adds every binding the planner can now derive, repeatedly, until nothing more
 * unlocks. Cheap: the map has two entries and will not have many more.
 */
export function closeDerived(bound: Set<BindingKey>): Set<BindingKey> {
  let changed = true
  while (changed) {
    changed = false
    for (const [produced, alternatives] of Object.entries(DERIVED_BINDINGS)) {
      if (bound.has(produced)) continue
      if (alternatives.some((inputs) => inputs.every((key) => bound.has(key)))) {
        bound.add(produced)
        changed = true
      }
    }
  }
  return bound
}

export interface Infeasibility {
  stage_id: string
  op_id: string
  missing: BindingKey[]
}

/**
 * Walks a plan in execution order and reports any op that runs before something
 * binds what it reads. An empty result means the plan is feasible.
 *
 * Xano runs the same check inside POST /run. A plan that fails it would spend
 * calls whose parameters resolve to nothing, so it is refused rather than
 * executed and debugged from the evidence rows afterwards.
 */
export function infeasibleOps(stages: Stage[], registry: Capability[]): Infeasibility[] {
  const produces = new Map(registry.map((c) => [c.capability_id, c.produces]))
  const bound = closeDerived(new Set<BindingKey>())
  const problems: Infeasibility[] = []

  for (const stage of stages) {
    for (const op of stage.ops) {
      const missing = op.requires.filter((key) => !bound.has(key))
      if (missing.length > 0) problems.push({ stage_id: stage.stage_id, op_id: op.op_id, missing })
    }
    // A stage is a barrier. What it binds is available to the next one, not to
    // its own siblings, which is what makes concurrency inside a stage safe.
    for (const op of stage.ops) {
      for (const key of produces.get(op.capability_id) ?? []) bound.add(key)
    }
    closeDerived(bound)
  }

  return problems
}
