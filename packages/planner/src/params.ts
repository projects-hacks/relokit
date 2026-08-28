import type { Capability, ParamValue } from '@relokit/schema'

/**
 * Registry templates say `self` because one row serves every constraint of its
 * type. The planner rewrites it to the real constraint id when it emits the op,
 * so what reaches Xano carries no placeholder.
 */
export function bindSelf(
  template: Capability['params_template'],
  constraintId: string,
): Record<string, ParamValue> {
  const bound: Record<string, ParamValue> = {}
  for (const [key, value] of Object.entries(template)) {
    bound[key] =
      typeof value === 'string'
        ? value.replaceAll('$constraint.self.', `$constraint.${constraintId}.`)
        : value
  }
  return bound
}

export function mergeParams(...parts: Record<string, ParamValue>[]): Record<string, ParamValue> {
  return Object.assign({}, ...parts) as Record<string, ParamValue>
}

/**
 * Pure, order independent hash. The planner may not import node:crypto, because
 * it may not import anything: it is a library that also runs in a browser.
 */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  )
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16)
}
