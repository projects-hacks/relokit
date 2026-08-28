import type { PlanResult } from '@relokit/schema'

/**
 * Shown before any result, because the plan exists before any call is made.
 * The panel is the argument that a planner exists at all, so it shows every
 * capability that was considered, not only the ones that won.
 */
export function PlanTrace({ result }: { result: PlanResult }) {
  return (
    <section className="panel">
      <h2>Plan</h2>
      <ol className="stages">
        {result.stages.map((stage) => (
          <li key={stage.stage_id}>
            <div className="stage-head">
              <span className={`tier tier-${stage.tier}`}>{stage.tier}</span>
              <strong>{stage.stage_id}</strong>
              <span className="muted">
                {stage.estimated_cost_units} {stage.estimated_cost_units === 1 ? 'call' : 'calls'}
              </span>
            </div>
            <ul className="ops">
              {[...new Set(stage.ops.map((op) => op.capability_id))].map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
            {stage.prune && stage.prune.on_fail.length > 0 && (
              <p className="muted">
                prunes on {stage.prune.on_fail.join(', ')}
                {stage.prune.slack.length > 0 && ', with slack'}
              </p>
            )}
          </li>
        ))}
      </ol>

      <h3>Why this order</h3>
      <table className="candidates">
        <thead>
          <tr>
            <th>capability</th>
            <th>for</th>
            <th>pass</th>
            <th>cover</th>
            <th>calls</th>
            <th>score</th>
          </tr>
        </thead>
        <tbody>
          {result.trace.candidates.map((c, i) => (
            <tr key={i} className={c.chosen ? 'chosen' : 'passed-over'}>
              <td>{c.capability_id}</td>
              <td>{c.constraint_id}</td>
              <td>{c.selectivity_prior}</td>
              <td>{c.coverage}</td>
              <td>{c.cost_units * c.entities_requiring_evaluation || 'free'}</td>
              <td>{c.score === null ? 'not scored' : c.score.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="decisions">
        {result.trace.decisions.map((d) => (
          <li key={d.step}>
            <strong>{d.step}</strong> {d.detail}
          </li>
        ))}
      </ul>
    </section>
  )
}
