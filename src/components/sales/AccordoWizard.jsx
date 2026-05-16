// Wizard creazione/modifica accordo commerciale — 4 step:
//   1. Dati base (fornitore, nome, periodo, locali, allegato)
//   2. Obiettivo (metrica + articoli/categorie/brand inclusi)
//   3. Scaglioni e premi
//   4. Review e conferma
// IN PROGRESS — primo render minimo, espanderò nei prossimi commit.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

async function apiCall(action, body = {}) {
  const { data: session } = await supabase.auth.getSession()
  const token = session?.session?.access_token
  const r = await fetch('/api/agreements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action, ...body }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'API error')
  return j
}

export default function AccordoWizard({ editId, onCancel, onSaved }) {
  const [step, setStep] = useState(1)
  const [suppliers, setSuppliers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [agr, setAgr] = useState({
    supplier_id: '',
    name: '',
    description: '',
    agreement_type: 'rappel',
    metric: 'revenue_eur',
    start_date: new Date().getFullYear() + '-01-01',
    end_date: new Date().getFullYear() + '-12-31',
    locales: null,
    reward_type: 'discount_pct',
    reward_value: '',
    reward_description: '',
    status: 'draft',
    tiers: [],
    items: [{ item_type: 'all' }],
  })

  useEffect(() => {
    apiCall('suppliers-list').then((j) => setSuppliers(j.suppliers || [])).catch(() => {})
    if (editId) {
      apiCall('get', { id: editId }).then((j) => {
        if (j.agreement) {
          setAgr({
            ...j.agreement,
            tiers: j.tiers || [],
            items: j.items?.length ? j.items : [{ item_type: 'all' }],
          })
        }
      }).catch((e) => setError(e.message))
    }
  }, [editId])

  function patch(p) { setAgr((s) => ({ ...s, ...p })) }

  async function save(asActive = false) {
    setError(''); setSaving(true)
    try {
      const payload = { ...agr, status: asActive ? 'active' : 'draft' }
      if (editId) payload.id = editId
      await apiCall('upsert', { agreement: payload })
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const canNext1 = agr.name.trim() && agr.start_date && agr.end_date
  const canNext2 = agr.metric && (agr.items?.length > 0)
  const canSave  = canNext1 && canNext2

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 13, padding: 6 }}>
          ← Annulla
        </button>
        <h2 style={{ margin: '0 0 0 12px', fontSize: 18, fontWeight: 600 }}>
          {editId ? 'Modifica accordo' : 'Nuovo accordo commerciale'}
        </h2>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: n <= step ? 'var(--blue)' : 'var(--border)',
          }} />
        ))}
      </div>

      {error && <div style={{ padding: 12, background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {step === 1 && (
        <Card title="Passo 1 di 4 — Dati base">
          <FieldGrid>
            <Field label="Nome accordo *">
              <input value={agr.name} onChange={(e) => patch({ name: e.target.value })}
                placeholder="es. Rappel beverage 2026" style={S.input} />
            </Field>
            <Field label="Fornitore">
              <select value={agr.supplier_id || ''} onChange={(e) => patch({ supplier_id: e.target.value || null })} style={S.input}>
                <option value="">— Seleziona (opzionale) —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Inizio periodo *">
              <input type="date" value={agr.start_date} onChange={(e) => patch({ start_date: e.target.value })} style={S.input} />
            </Field>
            <Field label="Fine periodo *">
              <input type="date" value={agr.end_date} onChange={(e) => patch({ end_date: e.target.value })} style={S.input} />
            </Field>
            <Field label="Descrizione (opzionale)" full>
              <textarea value={agr.description || ''} onChange={(e) => patch({ description: e.target.value })}
                rows={3} placeholder="Note interne, riferimenti contratto…" style={{ ...S.input, fontFamily: 'inherit', resize: 'vertical' }} />
            </Field>
          </FieldGrid>
        </Card>
      )}

      {step === 2 && (
        <Card title="Passo 2 di 4 — Obiettivo">
          <FieldGrid>
            <Field label="Tipo di accordo">
              <select value={agr.agreement_type} onChange={(e) => patch({ agreement_type: e.target.value })} style={S.input}>
                <option value="rappel">Rappel fine periodo</option>
                <option value="free_goods">Premio merce / omaggio</option>
                <option value="tiered_discount">Scaglioni progressivi</option>
                <option value="mix_target">Mix target articoli</option>
                <option value="flat_bonus">Bonus una tantum</option>
                <option value="volume_discount">Sconto volume</option>
              </select>
            </Field>
            <Field label="Metrica di misurazione">
              <select value={agr.metric} onChange={(e) => patch({ metric: e.target.value })} style={S.input}>
                <option value="revenue_eur">Fatturato in € (netto)</option>
                <option value="volume_liters">Volume in litri</option>
                <option value="volume_pieces">Volume in pezzi/casse</option>
                <option value="mix_percentage">% mix su articoli</option>
              </select>
            </Field>
            <Field full>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                <strong>Articoli inclusi nel target:</strong> per la prima versione, l'accordo vale sul
                <em> totale fatturato del fornitore</em> nel periodo. Filtri per articolo/categoria/brand verranno aggiunti nelle prossime iterazioni.
              </div>
            </Field>
          </FieldGrid>
        </Card>
      )}

      {step === 3 && (
        <Card title="Passo 3 di 4 — Scaglioni e premi">
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            Aggiungi le soglie pattuite. Lasciare vuoto se l'accordo ha un singolo target (usa il premio principale qui sotto).
          </div>
          {(agr.tiers || []).map((t, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr 40px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <input type="number" placeholder="Soglia" value={t.threshold || ''}
                onChange={(e) => patch({ tiers: agr.tiers.map((x, j) => j === i ? { ...x, threshold: e.target.value } : x) })}
                style={S.input} />
              <select value={t.reward_type || 'discount_pct'}
                onChange={(e) => patch({ tiers: agr.tiers.map((x, j) => j === i ? { ...x, reward_type: e.target.value } : x) })}
                style={S.input}>
                <option value="discount_pct">% sconto</option>
                <option value="discount_amount">€ sconto</option>
                <option value="free_goods">Merce omaggio</option>
                <option value="cash_bonus">Bonus cash</option>
              </select>
              <input type="number" placeholder="Valore" value={t.reward_value || ''}
                onChange={(e) => patch({ tiers: agr.tiers.map((x, j) => j === i ? { ...x, reward_value: e.target.value } : x) })}
                style={S.input} />
              <input placeholder="Descrizione premio" value={t.reward_description || ''}
                onChange={(e) => patch({ tiers: agr.tiers.map((x, j) => j === i ? { ...x, reward_description: e.target.value } : x) })}
                style={S.input} />
              <button onClick={() => patch({ tiers: agr.tiers.filter((_, j) => j !== i) })}
                style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
          ))}
          <button onClick={() => patch({ tiers: [...(agr.tiers || []), { threshold: '', reward_type: 'discount_pct', reward_value: '' }] })}
            style={{ background: 'var(--bg)', border: '1px dashed var(--border-md)', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: 'var(--text2)', cursor: 'pointer', marginTop: 4 }}>
            + Aggiungi scaglione
          </button>

          <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8 }}>Premio principale (se nessuno scaglione)</div>
            <FieldGrid>
              <Field label="Tipo">
                <select value={agr.reward_type || 'discount_pct'} onChange={(e) => patch({ reward_type: e.target.value })} style={S.input}>
                  <option value="discount_pct">% sconto</option>
                  <option value="discount_amount">€ sconto</option>
                  <option value="free_goods">Merce omaggio</option>
                  <option value="cash_bonus">Bonus cash</option>
                </select>
              </Field>
              <Field label="Valore">
                <input type="number" value={agr.reward_value || ''} onChange={(e) => patch({ reward_value: e.target.value })} style={S.input} />
              </Field>
              <Field label="Descrizione" full>
                <input value={agr.reward_description || ''} onChange={(e) => patch({ reward_description: e.target.value })}
                  placeholder="es. 6 casse Aperol 70cl omaggio" style={S.input} />
              </Field>
            </FieldGrid>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Passo 4 di 4 — Conferma">
          <ReviewRow label="Nome">{agr.name}</ReviewRow>
          <ReviewRow label="Fornitore">{suppliers.find((s) => s.id === agr.supplier_id)?.name || '—'}</ReviewRow>
          <ReviewRow label="Periodo">{agr.start_date} → {agr.end_date}</ReviewRow>
          <ReviewRow label="Tipo">{agr.agreement_type}</ReviewRow>
          <ReviewRow label="Metrica">{agr.metric}</ReviewRow>
          <ReviewRow label="Scaglioni">{agr.tiers?.length || 0}</ReviewRow>
          <ReviewRow label="Premio principale">
            {agr.reward_type && agr.reward_value ? `${agr.reward_value} (${agr.reward_type})` : '—'}
          </ReviewRow>
          <div style={{ marginTop: 16, padding: 12, background: 'var(--blue-bg)', color: 'var(--blue-text)', borderRadius: 6, fontSize: 12 }}>
            Salva come <strong>bozza</strong> per rivederlo dopo, oppure <strong>attiva</strong> per iniziare a tracciare l'avanzamento dalle fatture esistenti.
          </div>
        </Card>
      )}

      {/* Nav buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button
          onClick={() => step > 1 ? setStep(step - 1) : onCancel()}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
          {step > 1 ? '← Indietro' : 'Annulla'}
        </button>
        {step < 4 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
            style={{
              background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6,
              padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: (step === 1 && !canNext1) || (step === 2 && !canNext2) ? 0.4 : 1,
            }}>
            Avanti →
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => save(false)} disabled={saving || !canSave}
              style={{ background: 'var(--bg)', border: '1px solid var(--border-md)', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Salvataggio…' : 'Salva bozza'}
            </button>
            <button onClick={() => save(true)} disabled={saving || !canSave}
              style={{ background: '#10B981', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Attivazione…' : 'Salva e attiva ✓'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>
}

function Field({ label, children, full }) {
  return (
    <label style={{ display: 'block', gridColumn: full ? 'span 2' : 'auto' }}>
      {label && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>}
      {children}
    </label>
  )
}

function ReviewRow({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{children}</div>
    </div>
  )
}
