import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@xyflow/react/dist/style.css'
import './views/studio.css'
import { ThemeProvider } from './views/Theme'
import { App } from './views/App'
import { DesktopUpdates } from './views/DesktopUpdates'

createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider><DesktopUpdates><App /></DesktopUpdates></ThemeProvider></StrictMode>)
