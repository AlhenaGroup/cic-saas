// Gestione checklist timbratura entrata/uscita
// Una checklist è (locale, reparto, momento). I dipendenti la compilano via /timbra
// prima di poter timbrare entrata/uscita.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const iS = S.input

const REPARTI = ['Bar', 'Sala', 'Cucina', 'Cassa', 'Pizzeria', 'Magazzino', 'Altro']
const MOMENTI = [
  { v: 'entrata', l: '🟢 Entrata', color: '#10B981' },
  { v: 'uscita',  l: '🔴 Uscita',  color: '#EF4444' },
]
const ITEM_TYPES = [
  { v: 'sino',   l: 'Sì / No' },
  { v: 'testo',  l: 'Testo libero' },
  { v: 'numero', l: 'Numero' },
  { v: 'scelta', l: 'Scelta multipla' },
]

export default function ChecklistManager({ sp, sps }) {
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | object (new or existing)
  const [filterLocale, setFilterLocale] = useState('')
  const [filterReparto, setFilterReparto] = useState('')
  const [filterMomento, setFilterMomento] = useState('')

  const allLocali = [...new Set((sps || []).map(s => s.description).filter(Boolean))]

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('attendance_checklists')
      .select('*').order('locale').order('reparto').order('momento')
    setChecklists(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const remove = async (cl) => {
    if (!confirm(`Eliminare la checklist "${cl.nome}"? Le risposte già date verranno eliminate (cascade).`)) return
    await supabase.from('attendance_checklists').delete().eq('id', cl.id)
    load()
  }

  const duplicate = async (cl) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { id, created_at, updated_at, ...rest } = cl
    await supabase.from('attendance_checklists').insert({
      ...rest, user_id: user.id, nome: cl.nome + ' (copia)',
    })
    load()
  }

  const filtered = checklists.filter(c =>
    (!filterLocale || c.locale === filterLocale) &&
    (!filterReparto || c.reparto === filterReparto) &&
    (!filterMomento || c.momento === filterMomento)
  )

  return <Card title="📋 Checklist timbratura" badge={`${filtered.length} / ${checklists.length} totali`} extra={
    <button onClick={() => setEditing({ nome: '', locale: allLocali[0] || '', reparto: 'Bar', momento: 'entrata', attivo: true, items: [], google_sheet_tab: '' })}
      style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 700, border: 'none', padding: '6px 14px', cursor: 'pointer' }}>
      + Nuova checklist
    </button>
  }>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={{ ...iS, fontSize: 12 }}>
        <option value="">Tutti i locali</option>
        {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <select value={filterReparto} onChange={e => setFilterReparto(e.target.value)} style={{ ...iS, fontSize: 12 }}>
        <option value="">Tutti i reparti</option>
        {REPARTI.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <select value={filterMomento} onChange={e => setFilterMomento(e.target.value)} style={{ ...iS, fontSize: 12 }}>
        <option value="">Entrata + uscita</option>
        {MOMENTI.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
      </select>
    </div>

    {loading ? (
      <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
    ) : filtered.length === 0 ? (
      <div style={{ padding: 24, color: '#64748b', textAlign: 'center', fontSize: 13 }}>
        Nessuna checklist. Cliccando "+ Nuova checklist" puoi crearne una per locale + reparto + momento (entrata/uscita).
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome', 'Locale', 'Reparto', 'Momento', 'Domande', 'Foglio', 'Stato', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(cl => {
              const m = MOMENTI.find(x => x.v === cl.momento) || MOMENTI[0]
              return <tr key={cl.id} style={{ borderBottom: '1px solid #1a1f2e', cursor: 'pointer' }} onClick={() => setEditing(cl)}>
                <td style={{ ...S.td, fontWeight: 600, color: '#3B82F6' }}>{cl.nome}</td>
                <td style={S.td}>{cl.locale}</td>
                <td style={S.td}>{cl.reparto}</td>
                <td style={S.td}><span style={S.badge(m.color, m.color + '22')}>{m.l}</span></td>
                <td style={S.td}>{(cl.items || []).length}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 11 }}>{cl.google_sheet_tab || '—'}</td>
                <td style={S.td}>
                  {cl.attivo
                    ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Attiva</span>
                    : <span style={S.badge('#64748b', 'rgba(100,116,139,.12)')}>Off</span>}
                </td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <button onClick={() => duplicate(cl)} style={{ background: 'none', border: '1px solid #2a3042', color: '#94a3b8', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Duplica</button>
                  <button onClick={() => remove(cl)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>✕</button>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}

    {editing && <ChecklistEditor checklist={editing}
      allLocali={allLocali}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); load() }} />}
  </Card>
}

function ChecklistEditor({ checklist, allLocali, onClose, onSaved }) {
  const [c, setC] = useState({ ...checklist })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const isNew = !checklist.id

  const updateField = (k, v) => setC(prev => ({ ...prev, [k]: v }))

  const addItem = () => {
    const newItem = { id: crypto.randomUUID(), tipo: 'sino', label: '', required: true }
    setC(prev => ({ ...prev, items: [...(prev.items || []), newItem] }))
  }
  const updateItem = (id, patch) => setC(prev => ({
    ...prev, items: (prev.items || []).map(it => it.id === id ? { ...it, ...patch } : it)
  }))
  const removeItem = (id) => setC(prev => ({ ...prev, items: (prev.items || []).filter(it => it.id !== id) }))
  const moveItem = (id, dir) => setC(prev => {
    const items = [...(prev.items || [])]
    const i = items.findIndex(x => x.id === id)
    if (i < 0) return prev
    const j = i + dir
    if (j < 0 || j >= items.length) return prev
    ;[items[i], items[j]] = [items[j], items[i]]
    return { ...prev, items }
  })

  const save = async () => {
    setErr('')
    if (!c.nome.trim()) { setErr('Nome obbligatorio'); return }
    if (!c.locale) { setErr('Locale obbligatorio'); return }
    if (!c.reparto) { setErr('Reparto obbligatorio'); return }
    if (!(c.items || []).every(it => it.label.trim())) { setErr('Tutte le domande devono avere un testo'); return }
    setSaving(true)
    try {
      if (isNew) {
        const { data: { user } } = await supabase.auth.getUser()
        const { error } = await supabase.from('attendance_checklists').insert({
          ...c, user_id: user.id, items: c.items || [],
        })
        if (error) throw error
      } else {
        const { id, created_at, updated_at, user_id, ...rest } = c
        const { error } = await supabase.from('attendance_checklists').update({
          ...rest, items: c.items || [], updated_at: new Date().toISOString(),
        }).eq('id', id)
        if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 720 }}>
      <div style={{ padding: 16, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{isNew ? '➕ Nuova checklist' : '✎ Modifica: ' + c.nome}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Nome</div>
            <input value={c.nome || ''} onChange={e => updateField('nome', e.target.value)} placeholder="es. Apertura Bar" style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Locale</div>
            <select value={c.locale || ''} onChange={e => updateField('locale', e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="">—</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Reparto</div>
            <select value={c.reparto || ''} onChange={e => updateField('reparto', e.target.value)} style={{ ...iS, width: '100%' }}>
              {REPARTI.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Momento</div>
            <select value={c.momento || 'entrata'} onChange={e => updateField('momento', e.target.value)} style={{ ...iS, width: '100%' }}>
              {MOMENTI.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 14 }}>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Tab Google Sheet (opzionale)</div>
            <input value={c.google_sheet_tab || ''} onChange={e => updateField('google_sheet_tab', e.target.value)} placeholder="es. Checklist_Bar_Entrata" style={{ ...iS, width: '100%' }} />
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Le risposte vengono scritte sullo sheet del locale, in questo tab.</div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
            <input type="checkbox" checked={!!c.attivo} onChange={e => updateField('attivo', e.target.checked)} />
            <span style={{ fontSize: 13 }}>Attiva</span>
          </label>
        </div>

        {/* Items */}
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 14, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>Domande ({(c.items || []).length})</div>
            <button onClick={addItem} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              + Aggiungi domanda
            </button>
          </div>
          {(c.items || []).length === 0 && (
            <div style={{ padding: 14, color: '#64748b', textAlign: 'center', fontSize: 12, border: '1px dashed #2a3042', borderRadius: 8 }}>
              Nessuna domanda. Aggiungine almeno una.
            </div>
          )}
          {(c.items || []).map((it, i) => (
            <div key={it.id} style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 10, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button onClick={() => moveItem(it.id, -1)} disabled={i === 0} style={{ ...iS, padding: '2px 6px', fontSize: 10, cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                  <button onClick={() => moveItem(it.id, +1)} disabled={i === c.items.length - 1} style={{ ...iS, padding: '2px 6px', fontSize: 10, cursor: i === c.items.length - 1 ? 'not-allowed' : 'pointer', opacity: i === c.items.length - 1 ? 0.3 : 1 }}>▼</button>
                </div>
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 6 }}>
                  <input value={it.label} onChange={e => updateItem(it.id, { label: e.target.value })} placeholder={`Domanda ${i + 1}`} style={{ ...iS, width: '100%' }} />
                  <select value={it.tipo} onChange={e => updateItem(it.id, { tipo: e.target.value })} style={{ ...iS, width: '100%' }}>
                    {ITEM_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                  {it.tipo === 'scelta' && (
                    <input value={(it.opzioni || []).join(', ')} onChange={e => updateItem(it.id, { opzioni: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                      placeholder="Opzioni separate da virgola (es. Pulito, Da pulire, Rotto)" style={{ ...iS, width: '100%', gridColumn: '1 / -1' }} />
                  )}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>
                  <input type="checkbox" checked={!!it.required} onChange={e => updateItem(it.id, { required: e.target.checked })} />
                  Obbligatoria
                </label>
                <button onClick={() => removeItem(it.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 13, padding: 4 }}>✕</button>
              </div>
            </div>
          ))}
        </div>

        {err && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a3042' }}>
          <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
          <button onClick={save} disabled={saving}
            style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 700, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Salvo…' : '💾 Salva'}
          </button>
        </div>
      </div>
    </div>
  </div>
}
