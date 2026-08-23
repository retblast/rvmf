import { Component } from 'react'

// Keeps one broken section from blanking the whole app — a render crash
// inside any wrapped subtree becomes a local fallback with a reload
// button instead of an unmount-everything React error.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ui] section crashed:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="timeline-wrap">
          <div className="banner banner-error">
            Something broke while rendering this view.
          </div>
          <button
            type="button"
            className="pill-btn suggested"
            style={{ marginTop: 8 }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
