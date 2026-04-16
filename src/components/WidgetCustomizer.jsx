// Modal Notion-style per personalizzare ordine + visibilita' widget di un tab.
// Drag & drop nativo HTML5 (no dipendenze esterne).

import { useState } from 'react'
import { S } from './shared/styles.jsx'

const iS = S.input

export default function WidgetCustomizer({ tabKey, widgets, layout, onSave, onClose }) {
  // Inizializza state da layout salvato + widget non in layout (li metto in fondo, visibili)
  const initialItems = (() => {
    const map = {}
    layout.forEach((l, i) => { map[l.widget_id] = { visible: l.visible !== false, order: l.order ?? i } })
    const items = widgets.map(w => ({
      id: w.id,
      label: w.label,
      visible: map[w.id]?.visible !== false,
      order: map[w.id]?.order ?? 999,
    }))
    items.sort((a, b) => a.order - b.order)
    return items
  })()
  const [items, setItems] = useState(initialItems)
  const [dragId, setDragId] = useState(null)

  const handleDragStart = (id) => setDragId(id)
  const handleDragOver = (e, overId) => {
    e.preventDefault()
    if (!dragId || dragId === overId) return
    setItems(prev => {
      const dragIdx = prev.findIndex(x => x.id === dragId)
      const overIdx = prev.findIndex(x => x.id === overId)
      if (dragIdx < 0 || overIdx < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(overIdx, 0, moved)
      return next
    })
  }
  const handleDragEnd = () => setDragId(null)

  const toggleVisible = (id) => {
    setItems(prev => prev.map(x => x.id === id ? { ...x, visible: !x.visible } : x))
  }

  const reset = () => setItems(widgets.map((w, i) => ({ id: w.id, label: w.label, visible: true, order: i })))

  const save = () => {
    const layout = items.map((x, i) => ({ widget_id: x.id, visible: x.visible, order: i, size: 'normal' }))
    onSave(layout)
  }

  const visibleCount = items.filter(x => x.visible).length

  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
      <div style={{ padding: 20, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>Personalizza widget</h3>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{visibleCount} di {items.length} visibili · trascina per riordinare</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <div style={{ padding: 12 }}>
        {items.map(item => (
          <div
            key={item.id}
            draggable
            onDragStart={() => handleDragStart(item.id)}
            onDragOver={(e) => handleDragOver(e, item.id)}
            onDragEnd={handleDragEnd}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: dragId === item.id ? '#1e2636' : (item.visible ? '#1a1f2e' : '#0f1420'),
              border: '1px solid ' + (item.visible ? '#2a3042' : '#1a1f2e'),
              borderRadius: 6,
              marginBottom: 4,
              cursor: 'grab',
              opacity: item.visible ? 1 : 0.5,
              transition: 'all .1s',
            }}
          >
            <span style={{ color: '#475569', fontSize: 14, lineHeight: 1 }}>⠿</span>
            <span style={{ flex: 1, fontSize: 12, color: item.visible ? '#e2e8f0' : '#64748b' }}>{item.label}</span>
            <button
              onClick={() => toggleVisible(item.id)}
              title={item.visible ? 'Nascondi' : 'Mostra'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: item.visible ? '#10B981' : '#475569',
                fontSize: 13, padding: '4px 8px',
              }}
            >
              {item.visible ? '👁 Visibile' : '◌ Nascosto'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ padding: 16, borderTop: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <button onClick={reset} style={{ ...iS, padding: '8px 14px', cursor: 'pointer', color: '#94a3b8' }}>↺ Ripristina default</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
          <button onClick={save} style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: 'pointer' }}>💾 Salva</button>
        </div>
      </div>
    </div>
  </div>
}
