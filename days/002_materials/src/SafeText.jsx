import React, { Suspense } from 'react'
import { Text } from '@react-three/drei'

// troika <Text> loads its font asynchronously and *throws* if the font fails to
// resolve. Without a boundary that throw unmounts the whole R3F scene, leaving a
// blank canvas. This wrapper isolates each label: on failure the label simply
// disappears while the rest of the scene (the actual 3D study) keeps rendering.
class LabelBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function SafeText(props) {
  return (
    <LabelBoundary>
      <Suspense fallback={null}>
        <Text {...props} />
      </Suspense>
    </LabelBoundary>
  )
}
