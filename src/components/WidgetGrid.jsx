// WidgetGrid: renderizza una lista di widget in base a:
//   1. feature flag (l'utente ha widget.X nel suo piano?)
//   2. layout personalizzato (visibilita' + ordine salvato in user_widget_layout)
//
// Ogni widget e' un oggetto:
//   { id: 'kpi.ricavi', label: 'Ricavi totali', element: <Component .../> }
//
// Mostra bottone "Personalizza" che apre il customizer drag&drop.

import { useMemo, useState } from 'react'
import { useUserLayout, useUserPlan } from '../lib/features'
import { S } from './shared/styles.jsx'
import WidgetCustomizer from './WidgetCustomizer.jsx'

const iS = S.input

export default function WidgetGrid({ tabKey, widgets = [], gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }, className }) {
  const { features } = useUserPlan()
  const { layout, setLayout, loading } = useUserLayout(tabKey)
  const [customizing, setCustomizing] = useState(false)

  // Filtro: solo widget abilitati nel piano dell'utente
  const allowedWidgets = useMemo(() => {
    if (!features) return widgets
    return widgets.filter(w => features.allWidgets || features.widgets.has(w.id))
  }, [widgets, features])

  // Ordina + filtra in base al layout salvato
  const ordered = useMemo(() => {
    if (!layout || layout.length === 0) return allowedWidgets // default: ordine catalogo, tutti visibili
    const map = {}
    layout.forEach((l, i) => { map[l.widget_id] = { visible: l.visible !== false, order: l.order ?? i } })
    const visible = allowedWidgets.filter(w => map[w.id]?.visible !== false)
    return visible.sort((a, b) => (map[a.id]?.order ?? 999) - (map[b.id]?.order ?? 999))
  }, [allowedWidgets, layout])

  if (loading) return <div style={{ padding: 12, color: '#64748b' }}>…</div>

  return <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
      <button onClick={() => setCustomizing(true)}
        title="Personalizza widget"
        style={{ ...iS, fontSize: 11, padding: '4px 10px', cursor: 'pointer', color: '#94a3b8', background: 'transparent' }}>
        Personalizza
      </button>
    </div>
    <div style={gridStyle} className={className}>
      {ordered.map(w => <div key={w.id}>{w.element}</div>)}
    </div>
    {customizing && (
      <WidgetCustomizer
        tabKey={tabKey}
        widgets={allowedWidgets}
        layout={layout || []}
        onSave={(newLayout) => { setLayout(newLayout); setCustomizing(false) }}
        onClose={() => setCustomizing(false)}
      />
    )}
  </>
}
