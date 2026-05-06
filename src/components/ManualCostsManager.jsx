import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { S, Card, fmtD } from './shared/styles.jsx'
import { expandManualCost, VOCE_LABELS, CADENZE_LABELS } from '../lib/manualCosts.js'

const iS = S.input

// UI per gestire costi manuali (affitto, utenze, assicurazioni, ecc.)
// Ricorrenti o puntuali, associati a una voce del CE.
export default function ManualCostsManager({ from, to, onChanged }) {
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null) // null | 'new' | id

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('manual_costs').select('*').order('data_riferimento', { ascending: false })
    setCosts(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (id) => {
    if (!confirm('Eliminare questo costo?')) return
    await supabase.from('manual_costs').delete().eq('id', id)
    await load()
    onChanged?.()
  }

  const totalInPeriod = costs.reduce((s, c) => s + expandManualCost(c, from, to), 0)

  return <Card
    title="Costi manuali"
    badge={costs.length + ' voci · ' + fmtD(totalInPeriod) + ' nel periodo'}
    extra={
      <button onClick={() => setEditing('new')}
        style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 700, border: 'none', padding: '5px 14px', fontSize: 11, cursor: 'pointer' }}>
        + Aggiungi costo
      </button>
    }
  >
    {loading && <div style={{ padding: 16, textAlign: 'center', color: '#64748b', fontSize: 12 }}>Caricamento…</div>}
    {!loading && costs.length === 0 && (
      <div style={{ padding: 20, textAlign: 'center', color: '#475569', fontSize: 13 }}>
        Nessun costo manuale. Aggiungi affitto, utenze, assicurazioni ecc.
      </div>
    )}
    {!loading && costs.length > 0 && (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Descrizione', 'Voce', 'Importo', 'Ricorrenza', 'Data inizio', 'Fine', 'Nel periodo', ''].map(h =>
              <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {costs.map(c => {
              const inPeriod = expandManualCost(c, from, to)
              return <tr key={c.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 500 }}>{c.label}</td>
                <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{VOCE_LABELS[c.voce] || c.voce}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{fmtD(c.importo)}</td>
                <td style={{ ...S.td, fontSize: 12, color: c.ricorrente ? '#8B5CF6' : '#64748b' }}>
                  {c.ricorrente ? CADENZE_LABELS[c.cadenza] || c.cadenza : 'Puntuale'}
                </td>
                <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{c.data_riferimento}</td>
                <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{c.data_fine || '—'}</td>
                <td style={{ ...S.td, fontWeight: 600, color: inPeriod > 0 ? '#10B981' : '#475569' }}>{fmtD(inPeriod)}</td>
                <td style={S.td}>
                  <button onClick={() => setEditing(c.id)}
                    style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11, marginRight: 6 }}></button>
                  <button onClick={() => remove(c.id)}
                    style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>×</button>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}
    {editing && <CostForm
      cost={editing === 'new' ? null : costs.find(c => c.id === editing)}
      onClose={() => setEditing(null)}
      onSaved={async () => { setEditing(null); await load(); onChanged?.() }}
    />}
  </Card>
}

function CostForm({ cost, onClose, onSaved }) {
  const [label, setLabel] = useState(cost?.label || '')
  const [voce, setVoce] = useState(cost?.voce || 'struttura')
  const [importo, setImporto] = useState(cost?.importo || '')
  const [dataRif, setDataRif] = useState(cost?.data_riferimento || new Date().toISOString().split('T')[0])
  const [ricorrente, setRicorrente] = useState(cost?.ricorrente || false)
  const [cadenza, setCadenza] = useState(cost?.cadenza || 'mensile')
  const [dataFine, setDataFine] = useState(cost?.data_fine || '')
  const [note, setNote] = useState(cost?.note || '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!label.trim() || !importo) { alert('Descrizione e importo obbligatori'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { alert('Sessione scaduta'); setSaving(false); return }
    const payload = {
      user_id: user.id,
      label: label.trim(),
      voce,
      importo: Number(importo),
      data_riferimento: dataRif,
      ricorrente,
      cadenza: ricorrente ? cadenza : null,
      data_fine: ricorrente && dataFine ? dataFine : null,
      note: note || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = cost
      ? await supabase.from('manual_costs').update(payload).eq('id', cost.id)
      : await supabase.from('manual_costs').insert(payload)
    setSaving(false)
    if (error) { alert('Errore: ' + error.message); return }
    onSaved()
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 520 }}>
      <div style={{ padding: 18, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{cost ? 'Modifica costo' : '+ Nuovo costo manuale'}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Descrizione">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Es. Affitto locale, Energia elettrica…" style={{ ...iS, width: '100%' }} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Voce CE">
            <select value={voce} onChange={e => setVoce(e.target.value)} style={{ ...iS, width: '100%' }}>
              {Object.entries(VOCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Importo (€)">
            <input type="number" step="0.01" value={importo} onChange={e => setImporto(e.target.value)} style={{ ...iS, width: '100%' }} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Data di riferimento">
            <input type="date" value={dataRif} onChange={e => setDataRif(e.target.value)} style={{ ...iS, width: '100%' }} />
          </Field>
          <Field label={<label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={ricorrente} onChange={e => setRicorrente(e.target.checked)} />
            Ricorrente
          </label>}>
            <div style={{ fontSize: 10, color: '#64748b' }}>{ricorrente ? 'Si ripete automaticamente' : 'Una tantum'}</div>
          </Field>
        </div>
        {ricorrente && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 12, background: '#131825', borderRadius: 8, border: '1px solid #2a3042' }}>
            <Field label="Cadenza">
              <select value={cadenza} onChange={e => setCadenza(e.target.value)} style={{ ...iS, width: '100%' }}>
                {Object.entries(CADENZE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Fine ricorrenza (opz.)">
              <input type="date" value={dataFine} onChange={e => setDataFine(e.target.value)} style={{ ...iS, width: '100%' }} placeholder="Lascia vuoto per ricorrenza infinita" />
            </Field>
          </div>
        )}
        <Field label="Note (opz.)">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...iS, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
      </div>
      <div style={{ padding: 14, borderTop: '1px solid #2a3042', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} disabled={saving} style={{ ...iS, color: '#94a3b8', border: '1px solid #2a3042', padding: '7px 14px', cursor: 'pointer' }}>Annulla</button>
        <button onClick={submit} disabled={saving}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 700, border: 'none', padding: '7px 18px', cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Salvo…' : 'Salva'}
        </button>
      </div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
    {children}
  </div>
}
