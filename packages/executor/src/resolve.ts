import { resolveConstraintField, type Constraint, type ParamValue } from '@relokit/schema'

/**
 * The reference ref resolver.
 *
 * Xano owns execution. This exists so the contract can be exercised offline and
 * so there is something concrete for the Xano stack to match, which is why it
 * lives in a tool rather than in a package: nothing ships against it.
 *
 * The ref set is closed, so this is a switch rather than a lookup that can fail.
 */
export interface Bindings {
  constraints: Constraint[]
  /** Where the search happens. Named on the question rather than on any one
   * constraint, which is why it needs its own namespace. */
  anchor: string
  /**
   * Constraint fields an earlier op bound, keyed by the full ref, such as
   * `constraint.c3.destination_point`. These are the ones no amount of reading
   * the constraint can produce, so they are looked up before the resolver
   * contract is consulted.
   */
  produced: Record<string, string | number>
  stage: Record<string, Record<string, string | number>>
  cluster?: { id: string; lat: number; lng: number; radius_m: number }
  entity?: { id: string; lat: number; lng: number }
}

const REF = /\$[a-z_]+(?:\.[a-z0-9_]+)+/g

export class UnresolvedRef extends Error {
  constructor(readonly ref: string) {
    super(`nothing has bound ${ref}`)
  }
}

/**
 * Throws rather than dropping the parameter. Sending a directions request with
 * no destination is not a smaller question, it is a different one, and the
 * provider answers it with an error that looks like a network problem.
 */
export function resolveParams(
  params: Record<string, ParamValue>,
  bindings: Bindings,
): Record<string, string | number | boolean> {
  const resolved: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string') {
      resolved[key] = value
      continue
    }
    resolved[key] = value.replace(REF, (ref) => {
      const bound = resolveRef(ref, bindings)
      if (bound === undefined) throw new UnresolvedRef(ref)
      return String(bound)
    })
  }
  return resolved
}

function resolveRef(ref: string, bindings: Bindings): string | number | undefined {
  const [namespace, a, b] = ref.replace(/^\$/, '').split('.')

  if (namespace === 'query') {
    if (a === 'anchor') return bindings.anchor === '' ? undefined : bindings.anchor
    return bindings.produced['query.anchor_point']
  }

  if (namespace === 'entity' && bindings.entity) {
    if (a === 'id') return bindings.entity.id
    if (a === 'lat') return bindings.entity.lat
    if (a === 'lng') return bindings.entity.lng
    return undefined
  }

  if (namespace === 'cluster' && bindings.cluster) {
    if (a === 'id') return bindings.cluster.id
    if (a === 'lat') return bindings.cluster.lat
    if (a === 'lng') return bindings.cluster.lng
    if (a === 'radius_m') return bindings.cluster.radius_m
    return undefined
  }

  if (namespace === 'stage') return bindings.stage[a!]?.[b!]

  if (namespace === 'constraint') {
    const produced = bindings.produced[`constraint.${a}.${b}`]
    if (produced !== undefined) return produced
    const constraint = bindings.constraints.find((c) => c.id === a)
    if (!constraint || !b) return undefined
    const value = resolveConstraintField(constraint, b)
    return typeof value === 'boolean' ? String(value) : value
  }

  return undefined
}
