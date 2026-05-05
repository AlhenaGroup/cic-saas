// Theme toggle: persiste la scelta in localStorage (cic_theme = 'light' | 'dark')
// e applica data-theme="dark" su <html>. Default: light.
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'cic_theme'

function readInitial() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'dark' ? 'dark' : 'light'
  } catch { return 'light' }
}

function applyToDOM(theme) {
  if (typeof document === 'undefined') return
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

// Hook React: ritorna [theme, toggle].
export function useTheme() {
  const [theme, setTheme] = useState(readInitial)
  useEffect(() => {
    applyToDOM(theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  return [theme, toggle]
}

// Applica subito al boot (se l'utente aveva salvato dark in sessione precedente)
export function bootstrapTheme() {
  applyToDOM(readInitial())
}
