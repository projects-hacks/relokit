import { Component, type ReactNode } from 'react'
import { forget } from './lib/remember.ts'

/**
 * The last line. A render crash is almost always something remembered from an
 * older version of the page, so the remembered answer is let go and the app
 * tries once more from empty. Only if that also fails does it say so.
 */
export class Recover extends Component<{ children: ReactNode }, { failures: number }> {
  override state = { failures: 0 }

  static getDerivedStateFromError() {
    return null
  }

  override componentDidCatch() {
    forget()
    this.setState((previous) => ({ failures: previous.failures + 1 }))
  }

  override render() {
    if (this.state.failures > 1) {
      return (
        <div className="failure" style={{ margin: 'auto', padding: 40 }}>
          <p>Something is wrong with this page. Reload to start over.</p>
        </div>
      )
    }
    return <span key={this.state.failures}>{this.props.children}</span>
  }
}
