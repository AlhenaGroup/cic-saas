// Logo Convivia: due asset SVG (light/dark) per qualita' nitida e zero filter CSS.
// Light: /logo.svg (nero su trasparente)
// Dark:  /logo-dark.svg (bianco su trasparente)
// Selezione automatica via attribute selector di <html data-theme="dark">.
//
// Uso:
//   <Logo size={32} />                  // logo + nessuna label
//   <Logo size={32} label />            // logo + "CONVIVIA"
//   <Logo size={32} onClick={...} />    // cliccabile

import { useEffect, useState } from 'react'

function readTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

export default function Logo({ size = 32, label = false, onClick = null, color = 'var(--text)' }) {
  // Tieni l'asset in sync col tema corrente. data-theme cambia via setAttribute,
  // quindi un MutationObserver e' la via piu' semplice.
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const target = document.documentElement
    const obs = new MutationObserver(() => setTheme(readTheme()))
    obs.observe(target, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const src = theme === 'dark' ? '/logo-dark.svg' : '/logo.svg'
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        background: 'transparent', border: 'none', padding: 0,
        cursor: onClick ? 'pointer' : 'default', color,
        fontFamily: 'inherit',
      }}
    >
      <img src={src} alt="Convivia"
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
      {label && (
        <span style={{ fontSize: Math.round(size * 0.5), fontWeight: 700, letterSpacing: '.04em', color }}>
          CONVIVIA
        </span>
      )}
    </Wrapper>
  )
}
