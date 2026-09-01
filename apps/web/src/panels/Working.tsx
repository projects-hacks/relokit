import { useState } from 'react'
import type { AskResult } from '@relokit/client'
import { Ledger } from './Ledger.tsx'

/**
 * How the answer was reached.
 *
 * Shut by default, because someone looking for a home does not need it, and one
 * click away because anyone who wants to know whether to believe the answer
 * needs all of it: which source was asked what, which were considered and
 * passed over, and on what arithmetic.
 */
export function Working({ result }: { result: AskResult }) {
  const [open, setOpen] = useState(false)
  const chosen = result.plan.trace.candidates.filter((candidate) => candidate.chosen)
  const passedOver = result.plan.trace.candidates.filter((candidate) => !candidate.chosen)

  return (
    <section className="working" data-open={String(open)}>
      <button className="working-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>How this was worked out</span>
        <span className="working-hint">
          {result.plan.stages.length} steps · {result.cost.planned_units} planned ·{' '}
          {result.cost.actual_units} spent
        </span>
        <span className="chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="working-body">
          <p className="note">
            Each requirement is answered by whichever source can settle it for the fewest searches.
            The order is worked out before anything is asked.
          </p>

          <p className="eyebrow">Sources used</p>
          {/* Wider than the rail it now lives in, so it scrolls rather than
              clipping a column heading in half. */}
          <div className="scores-scroll">
            <table className="scores">
              <thead>
                <tr>
                  <th>source</th>
                  <th>for</th>
                  <th>rules out</th>
                  <th>answers</th>
                  <th>calls</th>
                </tr>
              </thead>
              <tbody>
                {chosen.map((candidate, index) => (
                  <tr key={index}>
                    <td>{candidate.capability_id}</td>
                    <td>{candidate.constraint_id}</td>
                    <td>
                      {Math.round((1 - candidate.selectivity_prior) * 100)}%
                      <span className="basis">{basis(candidate)}</span>
                    </td>
                    <td>{Math.round(candidate.coverage * 100)}%</td>
                    <td>
                      {candidate.cost_units * candidate.entities_requiring_evaluation || 'free'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {passedOver.length > 0 && (
            <>
              <p className="eyebrow">Considered and not used</p>
              <ul className="plain">
                {passedOver.slice(0, 6).map((candidate, index) => (
                  <li key={index}>
                    <b>{candidate.capability_id}</b> —{' '}
                    {REASON[candidate.reason] ?? candidate.reason}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="eyebrow">Decisions</p>
          <ul className="plain">
            {result.plan.trace.decisions.map((decision) => (
              <li key={decision.step}>{decision.detail}</li>
            ))}
          </ul>
          <Ledger result={result} />
        </div>
      )}
    </section>
  )
}

/** Whether a number was measured on real runs, and over how many answers. */
function basis(candidate: { prior_basis: string; observation_n: number }): string {
  if (candidate.prior_basis === 'measured_here')
    return `measured here, ${candidate.observation_n} answers`
  if (candidate.prior_basis === 'measured') return `measured, ${candidate.observation_n} answers`
  return 'assumed'
}

const REASON: Record<string, string> = {
  lower_score: 'another source answered the same thing for fewer searches',
  no_payback: 'it would have cost more searches than the results it could rule out',
  over_budget: 'the run was not allowed to spend that much',
  unbound: 'it needed something that never arrived',
  disabled: 'switched off in the registry',
  zero_coverage: 'it never actually answers this',
  no_matching_constraint: 'nothing in the question needed it',
}
