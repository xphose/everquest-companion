import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, GlobalStyles } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { theme } from '../theme/theme'
import { AppBackProvider } from '../appBack'
import { installOverlayPointerExit } from '../overlay/pointerExit'
import AdventureApp from './AdventureApp'

function report(cause: unknown): void {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  window.eq.reportError({ source: 'adventure', name: error.name, message: error.message, stack: error.stack })
}
class AdventureBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo): void { report(error) }
  render(): ReactNode {
    return this.state.failed ? <div style={{ padding: 16 }}>Adventure could not be displayed. <button onClick={() => location.reload()}>Reload overlay</button></div> : this.props.children
  }
}
window.addEventListener('error', (event) => report(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => report(event.reason))
installOverlayPointerExit()
const container = document.getElementById('root')
if (!container) throw new Error('Adventure root is missing')
createRoot(container).render(<AdventureBoundary><ThemeProvider theme={theme}><CssBaseline />
  <GlobalStyles styles={{ 'html, body, #root': { height: '100%', margin: 0, overflow: 'hidden', background: 'transparent' }, '.MuiPopover-paper, .MuiAutocomplete-paper': { backgroundColor: '#171a21' } }} />
  <AppBackProvider><AdventureApp /></AppBackProvider>
</ThemeProvider></AdventureBoundary>)
