// Barra sotto-tab riusabile (Vendite / Contabilità / Impostazioni / ...)
// Stile coerente con il resto: bordi piatti, color arancio quando attivo.
export default function SubTabsBar({ tabs, value, onChange }) {
  return <div style={{
    display: 'flex', gap: 2, borderBottom: '1px solid #2a3042',
    marginBottom: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
  }}>
    {tabs.map(t => {
      const active = value === t.key
      return <button key={t.key} onClick={() => onChange(t.key)} disabled={t.disabled}
        style={{
          padding: '8px 16px', fontSize: 12, fontWeight: active ? 700 : 500,
          color: active ? '#F59E0B' : (t.disabled ? '#475569' : '#94a3b8'),
          background: active ? 'rgba(245,158,11,.1)' : 'transparent',
          border: 'none',
          borderBottom: active ? '2px solid #F59E0B' : '2px solid transparent',
          cursor: t.disabled ? 'not-allowed' : 'pointer',
          opacity: t.disabled ? 0.5 : 1,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
        {t.label}
      </button>
    })}
  </div>
}
