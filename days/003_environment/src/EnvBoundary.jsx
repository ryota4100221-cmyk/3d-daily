import { Component } from 'react'

// A tiny error boundary specifically so a failed HDRI fetch (offline, blocked
// CDN, 404) can never blank the whole R3F scene. When drei's <Environment
// preset> suspends and its promise *rejects*, React re-throws during render;
// without a boundary the entire <Canvas> tree unmounts and you get a white
// page. Here we swallow it and render a procedural lighting rig instead, so the
// studio always has something to reflect.
export default class EnvBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err) {
    // Keep it quiet in the UI, but leave a breadcrumb in the console.
    // eslint-disable-next-line no-console
    console.warn('[Day003] HDRI environment failed, using procedural fallback:', err?.message)
  }

  render() {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}
