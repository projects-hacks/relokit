/**
 * Frozen contracts. Every package depends on this one and nothing here depends
 * on anything else in the repo.
 *
 * Changing a shape here changes the wire format between the browser, Xano and
 * the MCP server at the same time. Bump SCHEMA_VERSION when you do.
 */
export const SCHEMA_VERSION = '1'

export * from './units.ts'
export * from './subject.ts'
export * from './measures.ts'
export * from './constraints.ts'
export * from './capability.ts'
export * from './observation.ts'
export * from './evidence.ts'
export * from './plan.ts'
export * from './run.ts'
export * from './binding.ts'
