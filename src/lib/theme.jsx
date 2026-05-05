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

// Icona theme (SVG inline, no emoji). Mostra sole quando dark=true (per passare a light),
// luna quando dark=false (per passare a dark).
export function ThemeIcon({ dark, size = 18 }) {
  const stroke = 'currentColor'
  if (dark) {
    // Sole: cerchio + raggi
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="2"  x2="12" y2="4"/>
        <line x1="12" y1="20" x2="12" y2="22"/>
        <line x1="2"  y1="12" x2="4"  y2="12"/>
        <line x1="20" y1="12" x2="22" y2="12"/>
        <line x1="4.93"  y1="4.93"  x2="6.34"  y2="6.34"/>
        <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
        <line x1="4.93"  y1="19.07" x2="6.34"  y2="17.66"/>
        <line x1="17.66" y1="6.34"  x2="19.07" y2="4.93"/>
      </svg>
    )
  }
  // Luna
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}
