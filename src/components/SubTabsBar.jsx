// Barra sotto-tab riusabile (Vendite / Contabilità / Impostazioni / ...)
// Stile pill rounded coerente con la barra top-level.
export default function SubTabsBar({ tabs, value, onChange }) {
  return <div style={{
    display: 'flex', gap: 4, marginBottom: 16, overflowX: 'auto',
    WebkitOverflowScrolling: 'touch', paddingBottom: 4,
  }}>
    {tabs.map(t => {
      const active = value === t.key
      return <button key={t.key} onClick={() => onChange(t.key)} disabled={t.disabled}
        style={{
          padding: '8px 14px', fontSize: 12, fontWeight: 500,
          borderRadius: 'var(--radius-control)', border: '1px solid transparent',
          background: active ? 'var(--text)' : 'transparent',
          color: active ? 'var(--surface)' : (t.disabled ? 'var(--text3)' : 'var(--text2)'),
          cursor: t.disabled ? 'not-allowed' : 'pointer',
          opacity: t.disabled ? 0.5 : 1,
          whiteSpace: 'nowrap', flexShrink: 0,
          transition: 'all .2s', letterSpacing: '-0.01em',
        }}>
        {t.label}
      </button>
    })}
  </div>
}
