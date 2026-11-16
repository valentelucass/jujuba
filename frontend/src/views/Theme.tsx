import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'
const preference = 'jujuba.theme'
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return localStorage.getItem(preference) === 'light' ? 'light' : 'dark' }
    catch { return 'dark' }
  })

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    if (isTauri()) void getCurrentWindow().setTheme(theme).catch(() => {})
    try { localStorage.setItem(preference, theme) } catch { /* The theme still applies for this session. */ }
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('ThemeProvider ausente')
  return theme
}
