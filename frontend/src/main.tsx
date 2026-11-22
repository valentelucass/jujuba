import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@xyflow/react/dist/style.css'
import './views/studio.css'
import { ThemeProvider } from './views/Theme'
import { App } from './views/App'
import { DesktopUpdates } from './views/DesktopUpdates'

const root = createRoot(document.getElementById('root')!)
// The desktop window is revealed when this document finishes loading.
flushSync(() => root.render(<StrictMode><ThemeProvider><DesktopUpdates><App /></DesktopUpdates></ThemeProvider></StrictMode>))
