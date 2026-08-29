/**
 * The shape of the answer, before the answer.
 *
 * A spinner says only that something is happening. This says what is coming: a
 * photograph, an address, a price, and six lines that will each carry a verdict.
 * The page does not move when the real thing arrives.
 */
export function FindingSkeleton({ checks = 6 }: { checks?: number }) {
  return (
    <article className="finding skeleton" aria-hidden="true">
      <div className="shot skeleton-block" />
      <header className="finding-head">
        <span className="skeleton-line" style={{ width: '62%' }} />
        <span className="skeleton-line" style={{ width: 68 }} />
      </header>
      <div className="checks">
        {Array.from({ length: checks }, (_, index) => (
          <div className="check" key={index}>
            <span className="skeleton-dot" />
            <span>
              <span className="skeleton-line" style={{ width: `${44 + ((index * 13) % 34)}%` }} />
              <span
                className="skeleton-line faint"
                style={{ width: `${58 + ((index * 9) % 28)}%`, marginTop: 5 }}
              />
            </span>
            <span className="skeleton-line" style={{ width: 52 }} />
          </div>
        ))}
      </div>
    </article>
  )
}

export function FindingsSkeleton() {
  return (
    <div className="skeleton-stack">
      <div className="bucket-tabs skeleton" aria-hidden="true">
        {['', '', ''].map((_, index) => (
          <span key={index}>
            <span className="skeleton-line" style={{ width: 22, height: 15 }} />
            <span className="skeleton-line faint" style={{ width: 58 }} />
          </span>
        ))}
      </div>
      <FindingSkeleton />
      <FindingSkeleton checks={4} />
    </div>
  )
}
