// Modal CRUD per il catalogo tag (tag_definitions) — accessibile da CustomersManager.

import { useState, useEffect, useCallback } from 'react'
import { S } from '../shared/styles'
import { supabase } from '../../lib/supabase'

async function api(path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'API error')
  return j
}

const SWATCHES = ['#FFD700', '#10B981', '#3B82F6', '#94A3B8', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#84CC16']

export default function TagsManager({ locale, onClose }) {
  const [tags, setTags] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const r = await api('/api/tags', { action: 'list', locale })
      setTags(r.tags || [])
    } catch (e) { setError(e.message) }
  }, [locale])

  useEffect(() => { reload() }, [reload])

  const onSave = async () => {
    if (!editing?.nome?.trim()) return alert('Nome obbligatorio')
    try {
      await api('/api/tags', { action: 'upsert', tag: { ...editing, locale } })
      setEditing(null); reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  const onDelete = async (t) => {
    if (!confirm(`Eliminare il tag "${t.nome}"? Verrà rimosso da tutti i clienti che lo hanno.`)) return
    try {
      await api('/api/tags', { action: 'delete', id: t.id })
      reload()
    } catch (e) { alert('Errore: ' + e.message) }
  }

  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 95%)', maxHeight: '85vh', overflowY: 'auto', background: '#1a1f2e', padding: 20, borderRadius: 12, border: '1px solid #2a3042' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>Gestione tag · {locale}</h3>
        <button onClick={onClose} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Chiudi</button>
      </div>

      {error && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={{ marginBottom: 14 }}>
        {tags.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid #2a3042' }}>
            <span style={{ width: 14, height: 14, background: t.colore, borderRadius: 3, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.nome} {t.is_system && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 6 }}>preset</span>}</div>
              {t.descrizione && <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.descrizione}</div>}
            </div>
            <button onClick={() => setEditing(t)} style={btn('#0f1420', '#cbd5e1', '#2a3042')}>Modifica</button>
            <button onClick={() => onDelete(t)} style={btn('#EF4444' + '22', '#EF4444', '#EF4444' + '55')}>×</button>
          </div>
        ))}
      </div>

      <button onClick={() => setEditing({ nome: '', colore: '#94a3b8', descrizione: '' })} style={{ ...btn('#F59E0B', '#0f1420', '#F59E0B'), width: '100%' }}>+ Nuovo tag</button>

      {editing && <div style={{ marginTop: 16, padding: 14, background: '#0f1420', borderRadius: 8, border: '1px solid #2a3042' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{editing.id ? 'Modifica tag' : 'Nuovo tag'}</div>
        <input placeholder="Nome (es. Vegetariano)" value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })} style={{ ...S.input, width: '100%', marginBottom: 8 }} />
        <input placeholder="Descrizione (opzionale)" value={editing.descrizione || ''} onChange={e => setEditing({ ...editing, descrizione: e.target.value })} style={{ ...S.input, width: '100%', marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {SWATCHES.map(c => (
            <button key={c} onClick={() => setEditing({ ...editing, colore: c })} style={{
              width: 28, height: 28, background: c, borderRadius: 6,
              border: editing.colore === c ? '2px solid #fff' : '1px solid #2a3042', cursor: 'pointer'
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => setEditing(null)} style={btn('#1a1f2e', '#cbd5e1', '#2a3042')}>Annulla</button>
          <button onClick={onSave} style={btn('#F59E0B', '#0f1420', '#F59E0B')}>Salva</button>
        </div>
      </div>}
    </div>
  </div>
}

function btn(bg, color, border) {
  return { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: bg, color, border: `1px solid ${border}`, borderRadius: 6, cursor: 'pointer' }
}
