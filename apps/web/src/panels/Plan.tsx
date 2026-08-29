import type { AskEvent } from '@relokit/client'
import type { PlanResult } from '@relokit/schema'

/**
 * Shown before anything has been fetched, because the plan exists before the
 * first call. Each step fills in as it reports, so what is on screen is what has
 * happened rather than a march towards a number already known.
 */
export function Plan({ plan, events }: { plan: PlanResult | null; events: AskEvent[] }) {
  if (!plan) return null

  const done = new Map(
    events
      .filter((event): event is Extract<AskEvent, { kind: 'stage' }> => event.kind === 'stage')
      .map((event) => [event.stage_id, event]),
  )
  const skipped = new Map(
    events
      .filter((event): event is Extract<AskEvent, { kind: 'skipped' }> => event.kind === 'skipped')
      .map((event) => [event.stage_id, event]),
  )

  return (
    <section>
      <p className="eyebrow">How it will be checked</p>
      {plan.stages.map((stage) => {
        const report = done.get(stage.stage_id)
        const passed = skipped.get(stage.stage_id)
        return (
          <div className="plan-step" key={stage.stage_id} data-state={report ? 'done' : 'waiting'}>
            <span className="tick">{report ? '●' : '○'}</span>
            <span className="plan-name">
              {LABELS[stage.stage_id] ?? stage.stage_id}
              <span className="plan-tier">
                {passed ? 'not worth the calls' : `${stage.tier} · ${stage.ops.length} sources`}
              </span>
            </span>
            <span className="plan-count">
              {!report
                ? `~${stage.estimated_cost_units}`
                : report.entities_in === 0 && report.entities_out === 0
                  ? 'done'
                  : `${report.entities_in} → ${report.entities_out}`}
            </span>
          </div>
        )
      })}
    </section>
  )
}

const LABELS: Record<string, string> = {
  bounds: 'Locate where you are going',
  candidates: 'Find what is available',
  signals: 'Read what is happening nearby',
  clusters: 'Rule out whole neighbourhoods',
  exact: 'Measure the ones still standing',
}
