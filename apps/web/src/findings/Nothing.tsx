import type { AskResult } from '@relokit/client'

/**
 * When there is nothing to show.
 *
 * A blank panel next to a confident number is the worst thing this could do. If
 * a requirement could not be checked, or a source did not answer, that is the
 * result and it belongs here in plain words.
 */
export function Nothing({ result }: { result: AskResult }) {
  const said = new Map(result.constraint_set.constraints.map((c) => [c.id, c.source_text]))

  return (
    <div className="nothing">
      <p className="eyebrow">Nothing came back</p>
      <h2>No home cleared every requirement.</h2>

      {result.unanswered.length > 0 && (
        <>
          <p className="note">These could not be checked at all:</p>
          <ul className="plain">
            {result.unanswered.map((entry) => (
              <li key={entry.constraint_id}>
                <b>{said.get(entry.constraint_id) ?? entry.constraint_id}</b> — {entry.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      {result.problems.length > 0 && (
        <>
          <p className="note">And these calls did not happen:</p>
          <ul className="plain">
            {result.problems.slice(0, 4).map((problem, index) => (
              <li key={index}>{problem.detail}</li>
            ))}
          </ul>
        </>
      )}

      {result.unanswered.length === 0 && result.problems.length === 0 && (
        <p className="note">
          Everything was checked and nothing qualified. Loosening one requirement is usually enough,
          and what that would buy is below.
        </p>
      )}
    </div>
  )
}
