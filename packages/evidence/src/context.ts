import type { Constraint, EvidenceRow, ListingSummary, Provider } from '@relokit/schema'

/** What a mapper needs to know beyond the provider's own response. */
export interface MapperContext {
  op_id: string
  capability_id: string
  source: Provider
  /** Passed in rather than read from a clock, so a mapper stays testable. */
  fetched_at_ms: number
  ttl_seconds: number
}

export interface MapperResult {
  entities: ListingSummary[]
  evidence: EvidenceRow[]
}

export function row(
  context: MapperContext,
  fields: Omit<
    EvidenceRow,
    'source' | 'fetched_at_ms' | 'ttl_seconds' | 'expires_at_ms' | 'capability_id' | 'op_id'
  >,
): EvidenceRow {
  return {
    ...fields,
    source: context.source,
    fetched_at_ms: context.fetched_at_ms,
    ttl_seconds: context.ttl_seconds,
    expires_at_ms: context.fetched_at_ms + context.ttl_seconds * 1000,
    capability_id: context.capability_id,
    op_id: context.op_id,
  }
}

/**
 * A fact we tried to establish and could not. Never a rejection: rejection needs
 * verdict fail and eval_state evaluated, and this is neither.
 */
export function unknownRow(
  context: MapperContext,
  entityId: string,
  constraint: Constraint,
  reason: string,
  evalState: EvidenceRow['eval_state'] = 'skipped',
): EvidenceRow {
  return row(context, {
    entity_id: entityId,
    constraint_id: constraint.id,
    constraint_type: constraint.type,
    verdict: 'unknown',
    value_canonical: null,
    display_value: 'could not verify',
    source_url: null,
    confidence: 0,
    eval_state: evalState,
    reason,
  })
}
