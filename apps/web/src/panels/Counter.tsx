import type { AskEvent } from '@relokit/client'

/**
 * The narrowing, in the only form that is honest: each number is what a stage
 * reported, with the check that produced it named underneath. A bare count
 * falling from four thousand to five invites the question of whether anything
 * was really looked at.
 */
export function Counter({ events }: { events: AskEvent[] }) {
  const stages = events.filter(
    (event): event is Extract<AskEvent, { kind: 'stage' }> => event.kind === 'stage',
  )
  const steps = stages.filter((stage) => stage.entities_out > 0 || stage.entities_in > 0)
  if (steps.length === 0) return null

  return (
    <div className="counter">
      {steps.map((stage, index) => (
        <div key={stage.stage_id} style={{ display: 'contents' }}>
          {index > 0 && <span className="counter-arrow">→</span>}
          <span className="counter-step">
            <b>{stage.entities_out}</b>
            <span>{CAPTION[stage.stage_id] ?? stage.stage_id}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const CAPTION: Record<string, string> = {
  candidates: 'available at all',
  clusters: 'in reach',
  exact: 'measured',
}
