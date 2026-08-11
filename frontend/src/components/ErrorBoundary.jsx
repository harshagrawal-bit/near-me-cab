import { Component } from 'react'
import Button from '@/components/ui/Button'

/**
 * Last line of defence for render-time crashes.
 *
 * Users see a plain message and a way out — never a component stack. The full
 * error still goes to the console for developers.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // In production this is where an error reporter (Sentry etc.) would hook in.
    console.error('Unhandled UI error:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
        <div className="w-full max-w-md rounded-card border border-ink-200 bg-white p-7 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-danger-50 text-danger-600">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM10 5a1 1 0 0 1 1 1v4.5a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm0 9.75a1.15 1.15 0 1 1 0-2.3 1.15 1.15 0 0 1 0 2.3Z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-ink-900">Something went wrong</h1>
          <p className="mt-1.5 text-sm text-ink-500">
            The page hit an unexpected error. Reloading usually sorts it out.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => window.history.back()}>
              Go back
            </Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    )
  }
}
