import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'acme-wallboard-theme'

/** The OS preference, used until someone picks a theme. */
const systemTheme = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

/**
 * Light/dark theme on <html data-theme>. Follows the OS until the toggle is used, then
 * remembers the choice in localStorage.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [chosen, setChosen] = useState<Theme | null>(() => (localStorage.getItem(KEY) as Theme | null) ?? null)
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme = chosen ?? system

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(systemTheme())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(KEY, next)
    setChosen(next)
  }

  return { theme, toggle }
}
