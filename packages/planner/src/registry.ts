import type { Capability, ConstraintType, Subject, Tier } from '@relokit/schema'

/**
 * Capabilities that could run, grouped by what they answer. A candidate source
 * that cannot produce the subject asked for is not one of them.
 */
export function enabledByConstraintType(
  registry: Capability[],
  subject?: Subject,
): Map<ConstraintType, Capability[]> {
  const index = new Map<ConstraintType, Capability[]>()
  for (const capability of registry) {
    if (!capability.enabled) continue
    if (subject && capability.subjects.length > 0 && !capability.subjects.includes(subject))
      continue
    const bucket = index.get(capability.constraint_type)
    if (bucket) bucket.push(capability)
    else index.set(capability.constraint_type, [capability])
  }
  return index
}

export interface TierContext {
  cluster_count: number
  /** Survivors entering the entity tier, estimated from the stages before it. */
  entity_survivors: number
}

/**
 * How many times a capability at this tier has to be invoked. This is the term
 * that makes an expensive per-entity check lose to a cheap per-cluster one, and
 * it is why the entity tier always runs last against the smallest correct set.
 */
export function entitiesRequiringEvaluation(tier: Tier, context: TierContext): number {
  switch (tier) {
    case 'native':
      return 0
    case 'region':
      return 1
    case 'cluster':
      return context.cluster_count
    case 'entity':
      return context.entity_survivors
  }
}
