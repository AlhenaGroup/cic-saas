// Tab Produzione — HACCP / Etichettatura
// 3 sotto-tab: Schede produzione (template) · Lotti (esecuzioni) · Tracciabilità
//
// v1 (questo commit): solo Schede CRUD completo + auto-detect allergeni.
// Lotti e Tracciabilità sono placeholder per i prossimi commit.

import { useState, useEffect, useCallback, useMemo } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { applyMovement } from '../../lib/warehouse.js'
import { S, Card } from '../shared/styles.jsx'

const iS = S.input

// 14 allergeni Reg. UE 1169/2011
export const ALLERGENI = [
  { v: 'glutine',         l: 'Glutine',          ico: '' },
  { v: 'crostacei',       l: 'Crostacei',        ico: '' },
  { v: 'uova',            l: 'Uova',             ico: '' },
  { v: 'pesce',           l: 'Pesce',            ico: '' },
  { v: 'arachidi',        l: 'Arachidi',         ico: '' },
  { v: 'soia',            l: 'Soia',             ico: '' },
  { v: 'latte',           l: 'Latte',            ico: '' },
  { v: 'frutta_a_guscio', l: 'Frutta a guscio',  ico: '' },
  { v: 'sedano',          l: 'Sedano',           ico: '' },
  { v: 'senape',          l: 'Senape',           ico: '' },
  { v: 'sesamo',          l: 'Sesamo',           ico: '' },
  { v: 'solfiti',         l: 'Solfiti',          ico: '' },
  { v: 'lupini',          l: 'Lupini',           ico: '' },
  { v: 'molluschi',       l: 'Molluschi',        ico: '' },
]
export const ALLERGENI_BY_KEY = Object.fromEntries(ALLERGENI.map(a => [a.v, a]))

// Auto-detect allergeni da nome ingrediente (keyword matching).
// È solo un suggerimento iniziale: l'utente conferma/modifica manualmente.
const ALLERGEN_KEYWORDS = {
  glutine:         ['farina', 'pane', 'pasta', 'pizza', 'focaccia', 'biscotto', 'frumento', 'orzo', 'segale', 'avena', 'farro', 'kamut', 'cracker', 'piadina', 'crackers', 'grissini', 'taralli'],
  crostacei:       ['gambero', 'gamberetto', 'aragosta', 'astice', 'granchio', 'scampo', 'mazzancolla', 'mazzancolle'],
  uova:            ['uovo', 'uova', 'albume', 'tuorlo', 'maionese', 'frittata', 'omelette', 'meringa'],
  pesce:           ['pesce', 'tonno', 'salmone', 'merluzzo', 'spigola', 'orata', 'branzino', 'acciuga', 'acciughe', 'sardina', 'sgombro', 'baccalà', 'stoccafisso', 'pesce spada', 'sardine'],
  arachidi:        ['arachidi', 'arachide', 'noccioline', 'peanut'],
  soia:            ['soia', 'tofu', 'edamame', 'tempeh', 'salsa di soia', 'tamari'],
  latte:           ['latte', 'burro', 'panna', 'formaggio', 'mozzarella', 'parmigiano', 'pecorino', 'ricotta', 'yogurt', 'mascarpone', 'gorgonzola', 'crescenza', 'stracchino', 'taleggio', 'caciotta', 'caciocavallo', 'fontina', 'asiago', 'grana', 'provolone', 'scamorza', 'caprino', 'bufala', 'gelato', 'panna acida'],
  frutta_a_guscio: ['noce', 'noci', 'nocciola', 'nocciole', 'mandorla', 'mandorle', 'pistacchio', 'pistacchi', 'anacardio', 'anacardi', 'pinolo', 'pinoli', 'castagna', 'castagne', 'pecan'],
  sedano:          ['sedano'],
  senape:          ['senape', 'mostarda'],
  sesamo:          ['sesamo', 'tahini', 'tahin'],
  solfiti:         ['vino', 'aceto', 'frutta secca', 'uvetta', 'sciroppo', 'birra', 'liquore', 'champagne', 'spumante', 'prosecco'],
  lupini:          ['lupini', 'lupino'],
  molluschi:       ['cozza', 'cozze', 'vongola', 'vongole', 'ostrica', 'ostriche', 'calamaro', 'calamari', 'seppia', 'seppie', 'polpo', 'polipo', 'lumache', 'chiocciole'],
}

export function detectAllergeni(nome) {
  if (!nome) return []
  const n = nome.toLowerCase()
  const found = []
  for (const [key, kws] of Object.entries(ALLERGEN_KEYWORDS)) {
    if (kws.some(k => n.includes(k))) found.push(key)
  }
  return found
}

const SUB_TABS = [
  { k: 'schede',         l: 'Schede',         d: 'Template ricette di produzione' },
  { k: 'lotti',          l: 'Lotti',          d: 'Esecuzioni reali con etichette + QR' },
  { k: 'tracciabilita',  l: 'Tracciabilità',  d: 'Origine ingredienti, dove sono finiti' },
]

export default function ProductionManager({ sp, sps }) {
  // NON persistito: rientro parte dal primo sub-tab (Schede)
  const [subTab, setSubTab] = useState('schede')

  return <>
    <div className="m-wrap" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
      {SUB_TABS.map(t => {
        const active = subTab === t.k
        return <button key={t.k} onClick={() => setSubTab(t.k)} title={t.d}
          style={{ padding: '8px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
            color: active ? '#10B981' : '#94a3b8',
            background: active ? 'rgba(16,185,129,.12)' : '#131825',
            border: `1px solid ${active ? '#10B981' : '#2a3042'}`,
            borderRadius: 8, cursor: 'pointer' }}>
          {t.l}
        </button>
      })}
    </div>

    {subTab === 'schede' && <SchedeTab sp={sp} sps={sps} />}
    {subTab === 'lotti' && <LottiTab sp={sp} sps={sps} />}
    {subTab === 'tracciabilita' && <TracciabilitaTab sp={sp} sps={sps} />}
  </>
}

function PlaceholderTab({ title, msg }) {
  return <Card title={title}>
    <div style={{ padding: 24, color: 'var(--text2)', fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}></div>
      {msg}
    </div>
  </Card>
}

// ─── SCHEDE PRODUZIONE ──────────────────────────────────────────
function SchedeTab({ sp, sps }) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [filterLocale, setFilterLocale] = useState('')

  const allLocali = useMemo(() => [...new Set((sps || []).map(s => s.description).filter(Boolean))], [sps])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('production_recipes')
      .select('*').order('locale_produzione').order('nome')
    setRecipes(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => recipes.filter(r => {
    if (filterLocale && r.locale_produzione !== filterLocale) return false
    if (search && !r.nome.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [recipes, search, filterLocale])

  const remove = async (r) => {
    if (!confirm(`Eliminare la scheda "${r.nome}"? I lotti già prodotti restano (non collegati).`)) return
    await supabase.from('production_recipes').delete().eq('id', r.id)
    load()
  }

  const duplicate = async (r) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { id, created_at, updated_at, ...rest } = r
    await supabase.from('production_recipes').insert({ ...rest, user_id: user.id, nome: r.nome + ' (copia)' })
    load()
  }

  const approva = async (r) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('production_recipes').update({
      approved: true, approved_by: user.id, approved_at: new Date().toISOString(),
    }).eq('id', r.id)
    load()
  }

  return <Card title="Schede produzione" badge={`${filtered.length}/${recipes.length}`} extra={
    <button onClick={() => setEditing({
      nome: '', locale_produzione: allLocali[0] || '', locale_destinazione: '',
      ingredienti: [], procedimento: '', allergeni: [], conservazione: '+4°C frigo',
      shelf_life_days: 3, resa_quantita: '', resa_unita: 'KG', attivo: true,
      checklist_haccp_template: [], richiede_foto: false, durata_attesa_minuti: '',
    })}
      style={{ ...iS, background: '#10B981', color: 'var(--text)', fontWeight: 700, border: 'none', padding: '6px 14px', cursor: 'pointer' }}>
      + Nuova scheda
    </button>
  }>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <input placeholder="Cerca scheda…" value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...iS, flex: 1, minWidth: 200 }} />
      <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={iS}>
        <option value="">Tutti i locali</option>
        {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
    </div>

    {loading ? (
      <div style={{ padding: 24, color: 'var(--text3)', textAlign: 'center' }}>Caricamento…</div>
    ) : recipes.length === 0 ? (
      <div style={{ padding: 30, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6 }}>
        Nessuna scheda produzione.<br/>
        <span style={{ fontSize: 12 }}>
          Le schede sono i "template" delle preparazioni interne (es. tiramisù, farinata, salse).<br/>
          Da una scheda potrai poi creare i lotti reali con etichette HACCP.
        </span>
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Nome', 'Produzione', 'Destinazione', 'Resa', 'Conservazione', 'Shelf life', 'Allergeni', 'Stato', ''].map(h =>
              <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} onClick={() => setEditing(r)}
                style={{ borderBottom: '1px solid #1a1f2e', cursor: 'pointer' }}>
                <td style={{ ...S.td, fontWeight: 600, color: '#3B82F6' }}>
                  {r.nome}
                  {r.approved === false && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', marginTop: 2 }}>
                      Da confermare {r.created_by_employee_name ? `· da ${r.created_by_employee_name}` : ''}
                    </div>
                  )}
                </td>
                <td style={S.td}>{r.locale_produzione}</td>
                <td style={{ ...S.td, color: 'var(--text2)' }}>{r.locale_destinazione || '—'}</td>
                <td style={S.td}>{r.resa_quantita ? `${r.resa_quantita} ${r.resa_unita || ''}` : '—'}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 11 }}>{r.conservazione || '—'}</td>
                <td style={{ ...S.td, color: 'var(--text2)' }}>{r.shelf_life_days ? r.shelf_life_days + 'gg' : '—'}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {(r.allergeni || []).slice(0, 5).map(a => {
                      const meta = ALLERGENI_BY_KEY[a]
                      return meta ? <span key={a} title={meta.l} style={{ fontSize: 11 }}>{meta.ico}</span> : null
                    })}
                    {(r.allergeni || []).length > 5 && <span style={{ color: 'var(--text3)', fontSize: 10 }}>+{(r.allergeni || []).length - 5}</span>}
                    {(r.allergeni || []).length === 0 && <span style={{ color: 'var(--text3)', fontSize: 10 }}>—</span>}
                  </div>
                </td>
                <td style={S.td}>
                  {r.attivo
                    ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Attiva</span>
                    : <span style={S.badge('#64748b', 'rgba(100,116,139,.12)')}>Off</span>}
                </td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  {r.approved === false && (
                    <button onClick={() => approva(r)} title="Conferma scheda creata da staff"
                      style={{ background: '#10B981', color: 'var(--text)', border: 'none', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>Approva</button>
                  )}
                  <button onClick={() => duplicate(r)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text2)', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Dup</button>
                  <button onClick={() => remove(r)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {editing && <SchedaEditor recipe={editing} allLocali={allLocali}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); load() }} />}
  </Card>
}

function SchedaEditor({ recipe, allLocali, onClose, onSaved }) {
  const [r, setR] = useState({ ...recipe })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [articleNames, setArticleNames] = useState([])
  const isNew = !recipe.id

  // Carica nomi articoli magazzino per autocomplete ingredienti
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('warehouse_invoice_items')
        .select('nome_articolo, unita').not('nome_articolo', 'is', null).limit(2000)
      const set = new Map()
      ;(data || []).forEach(it => {
        if (it.nome_articolo && !set.has(it.nome_articolo)) set.set(it.nome_articolo, it.unita || '')
      })
      setArticleNames([...set.entries()].map(([nome, unita]) => ({ nome, unita })))
    })()
  }, [])

  const update = (k, v) => setR(prev => ({ ...prev, [k]: v }))
  const toggleAllergen = (a) => setR(prev => ({
    ...prev,
    allergeni: (prev.allergeni || []).includes(a)
      ? prev.allergeni.filter(x => x !== a)
      : [...(prev.allergeni || []), a],
  }))

  // Aggiorna allergeni auto-rilevati ad ogni cambio ingredienti
  const autoDetectFromIngredients = () => {
    const detected = new Set(r.allergeni || [])
    ;(r.ingredienti || []).forEach(i => {
      detectAllergeni(i.nome_articolo).forEach(a => detected.add(a))
    })
    update('allergeni', [...detected])
  }

  const addIng = () => setR(prev => ({
    ...prev, ingredienti: [...(prev.ingredienti || []), { nome_articolo: '', quantita: '', unita: '' }]
  }))
  const updIng = (i, patch) => setR(prev => ({
    ...prev, ingredienti: prev.ingredienti.map((x, idx) => idx === i ? { ...x, ...patch } : x)
  }))
  const rmIng = (i) => setR(prev => ({
    ...prev, ingredienti: prev.ingredienti.filter((_, idx) => idx !== i)
  }))

  const save = async () => {
    setErr('')
    if (!r.nome?.trim()) { setErr('Nome obbligatorio'); return }
    if (!r.locale_produzione) { setErr('Locale produzione obbligatorio'); return }
    setSaving(true)
    try {
      const cleaned = {
        ...r,
        ingredienti: (r.ingredienti || []).filter(i => i.nome_articolo?.trim() && i.quantita),
        resa_quantita: r.resa_quantita ? Number(r.resa_quantita) : null,
        shelf_life_days: r.shelf_life_days ? Number(r.shelf_life_days) : null,
        durata_attesa_minuti: r.durata_attesa_minuti ? Number(r.durata_attesa_minuti) : null,
        checklist_haccp_template: Array.isArray(r.checklist_haccp_template) ? r.checklist_haccp_template.filter(it => it.label?.trim()) : [],
      }
      if (isNew) {
        const { data: { user } } = await supabase.auth.getUser()
        const { error } = await supabase.from('production_recipes').insert({ ...cleaned, user_id: user.id })
        if (error) throw error
      } else {
        const { id, created_at, updated_at, user_id, ...rest } = cleaned
        const { error } = await supabase.from('production_recipes')
          .update({ ...rest, updated_at: new Date().toISOString() }).eq('id', id)
        if (error) throw error
      }
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 760 }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{isNew ? 'Nuova scheda produzione' : '' + r.nome}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      <div style={{ padding: 20 }}>
        {/* Anagrafica */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Nome</div>
            <input value={r.nome || ''} onChange={e => update('nome', e.target.value)} placeholder="es. Tiramisù" style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Locale produzione</div>
            <select value={r.locale_produzione || ''} onChange={e => update('locale_produzione', e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="">—</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Locale destinazione (opz.)</div>
            <select value={r.locale_destinazione || ''} onChange={e => update('locale_destinazione', e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="">— uguale a produzione —</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Resa quantità</div>
            <input type="number" step="0.001" value={r.resa_quantita ?? ''} onChange={e => update('resa_quantita', e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>UM resa</div>
            <select value={r.resa_unita || ''} onChange={e => update('resa_unita', e.target.value)} style={{ ...iS, width: '100%' }}>
              {['KG', 'GR', 'LT', 'ML', 'PZ', 'PORZIONI'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Conservazione</div>
            <input value={r.conservazione || ''} onChange={e => update('conservazione', e.target.value)} placeholder="+4°C frigo" style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Shelf life (gg)</div>
            <input type="number" value={r.shelf_life_days ?? ''} onChange={e => update('shelf_life_days', e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
        </div>

        {/* Ingredienti */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Ingredienti ({(r.ingredienti || []).length})</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={autoDetectFromIngredients}
                style={{ ...iS, background: '#F59E0B', color: 'var(--text)', border: 'none', padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                title="Rileva allergeni dai nomi degli ingredienti">
                Auto-allergeni
              </button>
              <button onClick={addIng}
                style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                + Ingrediente
              </button>
            </div>
          </div>
          {(r.ingredienti || []).length === 0 && (
            <div style={{ padding: 12, color: 'var(--text3)', textAlign: 'center', fontSize: 12, border: '1px dashed #2a3042', borderRadius: 8 }}>
              Aggiungi gli ingredienti che servono per produrre questo articolo.
            </div>
          )}
          {(r.ingredienti || []).map((ing, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 80px auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input list={`art-list-${i}`} value={ing.nome_articolo || ''}
                onChange={e => {
                  const v = e.target.value
                  const match = articleNames.find(a => a.nome === v)
                  updIng(i, { nome_articolo: v, ...(match && !ing.unita ? { unita: match.unita } : {}) })
                }}
                placeholder="Articolo magazzino" style={{ ...iS, width: '100%' }} />
              <datalist id={`art-list-${i}`}>
                {articleNames.slice(0, 200).map(a => <option key={a.nome} value={a.nome} />)}
              </datalist>
              <input type="number" step="0.001" value={ing.quantita ?? ''} onChange={e => updIng(i, { quantita: e.target.value })}
                placeholder="Qty" style={{ ...iS, width: '100%', textAlign: 'center' }} />
              <select value={ing.unita || ''} onChange={e => updIng(i, { unita: e.target.value })} style={{ ...iS, width: '100%', fontSize: 11 }}>
                {['', 'KG', 'GR', 'LT', 'ML', 'CL', 'PZ'].map(u => <option key={u} value={u}>{u || '—'}</option>)}
              </select>
              <button onClick={() => rmIng(i)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 13 }}>×</button>
            </div>
          ))}
        </div>

        {/* Allergeni */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Allergeni dichiarati <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 400 }}>(Reg. UE 1169/2011)</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ALLERGENI.map(a => {
              const sel = (r.allergeni || []).includes(a.v)
              return <button key={a.v} onClick={() => toggleAllergen(a.v)}
                style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${sel ? '#EF4444' : '#2a3042'}`,
                  background: sel ? 'rgba(239,68,68,.1)' : '#131825',
                  color: sel ? '#EF4444' : '#94a3b8', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                {a.ico} {a.l}
              </button>
            })}
          </div>
        </div>

        {/* Procedimento */}
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Procedimento (opz.)</div>
          <textarea value={r.procedimento || ''} onChange={e => update('procedimento', e.target.value)}
            placeholder="Es. 1) Montare i tuorli con lo zucchero. 2) Aggiungere il mascarpone. 3) Inzuppare i savoiardi nel caffè. CCP: temperatura conservazione +4°C max."
            rows={4} style={{ ...iS, width: '100%', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        </label>

        {/* Configurazione mobile produzione */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Configurazione mobile (per dipendenti)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Durata attesa (min)</div>
              <input type="number" value={r.durata_attesa_minuti ?? ''} onChange={e => update('durata_attesa_minuti', e.target.value)}
                placeholder="es. 30" style={{ ...iS, width: '100%' }} />
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Mostrato come riferimento al dipendente</div>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer', padding: '20px 0 0' }}>
              <input type="checkbox" checked={!!r.richiede_foto} onChange={e => update('richiede_foto', e.target.checked)} />
              Richiedi foto del prodotto finito
            </label>
          </div>
          {/* Checklist HACCP */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>Checklist HACCP <span style={{ color: 'var(--text3)' }}>(domande OK/KO da compilare durante la produzione)</span></div>
              <button onClick={() => update('checklist_haccp_template', [...(r.checklist_haccp_template || []), { id: crypto.randomUUID(), label: '', required: true }])}
                style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                + Domanda
              </button>
            </div>
            {(r.checklist_haccp_template || []).length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Nessuna domanda. Esempi: "Temperatura cottura corretta", "Attrezzatura sanificata", "Conservazione coperta".</div>
            )}
            {(r.checklist_haccp_template || []).map((it, i) => (
              <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, marginBottom: 4 }}>
                <input value={it.label} onChange={e => update('checklist_haccp_template', r.checklist_haccp_template.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                  placeholder={`Domanda ${i + 1}`} style={{ ...iS, width: '100%' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)' }}>
                  <input type="checkbox" checked={!!it.required} onChange={e => update('checklist_haccp_template', r.checklist_haccp_template.map((x, idx) => idx === i ? { ...x, required: e.target.checked } : x))} />
                  Obbl.
                </label>
                <button onClick={() => update('checklist_haccp_template', r.checklist_haccp_template.filter((_, idx) => idx !== i))}
                  style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 13 }}></button>
              </div>
            ))}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!r.attivo} onChange={e => update('attivo', e.target.checked)} />
          Scheda attiva (i dipendenti possono usarla per nuovi lotti)
        </label>

        {err && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
          <button onClick={save} disabled={saving}
            style={{ ...iS, background: '#10B981', color: 'var(--text)', border: 'none', padding: '8px 20px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Salvo…' : 'Salva scheda'}
          </button>
        </div>
      </div>
    </div>
  </div>
}

// ─── LOTTI PRODUZIONE ───────────────────────────────────────────
// Generazione codice lotto univoco: P-YYYYMMDD-NNN (NNN progressivo del giorno per user)
async function generateLottoCode(userId) {
  const today = new Date()
  const yyyymmdd = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0')
  const prefix = `P-${yyyymmdd}`
  const { data } = await supabase.from('production_batches')
    .select('lotto').eq('user_id', userId).like('lotto', prefix + '%').order('lotto', { ascending: false }).limit(1)
  let next = 1
  if (data?.[0]?.lotto) {
    const m = data[0].lotto.match(/-(\d+)$/)
    if (m) next = Number(m[1]) + 1
  }
  return `${prefix}-${String(next).padStart(3, '0')}`
}

function LottiTab({ sp, sps }) {
  const [batches, setBatches] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(null) // null | { recipe, qty, ... }
  const [filterLocale, setFilterLocale] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [filterMobile, setFilterMobile] = useState('') // '' | 'mobile' | 'admin'

  const allLocali = useMemo(() => [...new Set((sps || []).map(s => s.description).filter(Boolean))], [sps])

  const load = useCallback(async () => {
    setLoading(true)
    const [b, r] = await Promise.all([
      supabase.from('production_batches').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('production_recipes').select('*').eq('attivo', true).order('nome'),
    ])
    setBatches(b.data || [])
    setRecipes(r.data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => batches.filter(b => {
    if (filterLocale && b.locale_produzione !== filterLocale) return false
    if (filterStato && b.stato !== filterStato) return false
    if (filterMobile === 'mobile' && !b.da_mobile) return false
    if (filterMobile === 'admin' && b.da_mobile) return false
    return true
  }), [batches, filterLocale, filterStato, filterMobile])

  // Helper anomalie
  const getAnomalie = (b) => {
    const anom = []
    const recipe = recipes.find(r => r.id === b.recipe_id)
    if (recipe) {
      // Resa anomala (±20% rispetto a scheda)
      if (recipe.resa_quantita && b.quantita_prodotta) {
        const ratio = Number(b.quantita_prodotta) / Number(recipe.resa_quantita)
        if (ratio < 0.8 || ratio > 1.2) anom.push({ tipo: 'resa', label: `Resa ${Math.round(ratio * 100)}% (atteso 100%)` })
      }
      // Durata anomala
      if (recipe.durata_attesa_minuti && b.durata_minuti) {
        if (b.durata_minuti < recipe.durata_attesa_minuti * 0.5) {
          anom.push({ tipo: 'durata', label: `Solo ${b.durata_minuti}min (attesi ~${recipe.durata_attesa_minuti}min)` })
        }
      }
    }
    // Checklist HACCP con risposte KO
    if (b.checklist_haccp && typeof b.checklist_haccp === 'object') {
      const ko = Object.values(b.checklist_haccp).filter(v => v === false).length
      if (ko > 0) anom.push({ tipo: 'checklist', label: `${ko} check KO` })
    }
    return anom
  }

  const annulla = async (b) => {
    if (b.stato === 'annullato') {
      alert('Lotto già annullato.')
      return
    }
    if (!confirm(`Annullare il lotto ${b.lotto}?\n\nVerranno ripristinati i movimenti magazzino:\n- ingredienti riaccreditati (carico inverso dello scarico)\n- prodotto finito riscaricato (scarico inverso del carico)\n\nL'operazione è tracciata e visibile nello storico movimenti.`)) return

    try {
      // 1. Trova TUTTI i movimenti originali del lotto (link via production_batch_id, fallback riferimento_id)
      let { data: movs } = await supabase.from('article_movement')
        .select('*').eq('production_batch_id', b.id)
      if (!movs || movs.length === 0) {
        const { data: byRef } = await supabase.from('article_movement')
          .select('*').eq('riferimento_id', b.id).eq('fonte', 'produzione')
        movs = byRef || []
      }

      if (movs.length === 0) {
        // Nessun movimento trovato — solo cambio stato (es. lotto creato manualmente senza scarichi)
        await supabase.from('production_batches').update({ stato: 'annullato' }).eq('id', b.id)
        load()
        return
      }

      // 2. Per ogni movimento originale crea il suo inverso
      // scarico -> carico, carico -> scarico, trasferimento_out/in -> idem invertiti
      const inverseTipo = {
        scarico: 'carico',
        carico: 'scarico',
        trasferimento_out: 'trasferimento_in',
        trasferimento_in: 'trasferimento_out',
      }
      for (const m of movs) {
        const tipoInv = inverseTipo[m.tipo]
        if (!tipoInv) continue // skip apertura/correzione: non si invertono
        try {
          await applyMovement({
            locale: m.locale, subLocation: m.sub_location,
            nomeArticolo: m.nome_articolo,
            tipo: tipoInv, quantita: m.quantita, unita: m.unita,
            prezzoUnitario: m.prezzo_unitario,
            fonte: 'annullamento_produzione',
            riferimentoId: b.id,
            riferimentoLabel: `Annullamento lotto ${b.lotto}`,
          })
        } catch (e) {
          console.warn('[annulla rollback]', m.nome_articolo, m.tipo, '→', tipoInv, e.message)
        }
      }

      // 3. Cambia stato del batch
      await supabase.from('production_batches').update({ stato: 'annullato' }).eq('id', b.id)
      load()
      alert(`Lotto ${b.lotto} annullato. ${movs.length} movimenti magazzino ripristinati.`)
    } catch (e) {
      console.error('[annulla lotto]', e)
      alert('Errore annullamento: ' + e.message)
    }
  }

  return <Card title="Lotti produzione" badge={`${filtered.length}/${batches.length}`} extra={
    <button onClick={() => setCreating({ recipe: null })} disabled={recipes.length === 0}
      style={{ ...iS, background: '#10B981', color: 'var(--text)', fontWeight: 700, border: 'none', padding: '6px 14px', cursor: recipes.length ? 'pointer' : 'not-allowed', opacity: recipes.length ? 1 : 0.5 }}>
      + Nuovo lotto
    </button>
  }>
    {recipes.length === 0 ? (
      <div style={{ padding: 30, color: 'var(--text3)', textAlign: 'center', fontSize: 13 }}>
        Per creare lotti devi prima definire delle <strong>Schede produzione</strong> (tab Schede).
      </div>
    ) : <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={iS}>
          <option value="">Tutti i locali</option>
          {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterStato} onChange={e => setFilterStato(e.target.value)} style={iS}>
          <option value="">Tutti gli stati</option>
          <option value="attivo">Attivi</option>
          <option value="consumato">Consumati</option>
          <option value="scaduto">Scaduti</option>
          <option value="annullato">Annullati</option>
        </select>
        <select value={filterMobile} onChange={e => setFilterMobile(e.target.value)} style={iS}>
          <option value="">Tutte le origini</option>
          <option value="mobile">Da mobile</option>
          <option value="admin">Solo da admin</option>
        </select>
      </div>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--text3)', textAlign: 'center' }}>Caricamento…</div>
      ) : batches.length === 0 ? (
        <div style={{ padding: 30, color: 'var(--text3)', textAlign: 'center', fontSize: 13 }}>
          Nessun lotto prodotto. Click "+ Nuovo lotto" per registrarne uno.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Lotto', 'Prodotto', 'Data', 'Scadenza', 'Locale', 'Quantità', 'Durata', 'Operatore', 'Anomalie', 'Stato', ''].map(h =>
                <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map(b => {
                const oggi = new Date().toISOString().slice(0, 10)
                const isScaduto = b.data_scadenza && b.data_scadenza < oggi
                const giorniMancanti = b.data_scadenza ? Math.ceil((new Date(b.data_scadenza) - new Date(oggi)) / 86400000) : null
                const anomalie = getAnomalie(b)
                return <tr key={b.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 700, color: '#3B82F6' }}>
                    {b.lotto}
                    {b.da_mobile && <span title="Creato da mobile (dipendente)" style={{ marginLeft: 4, fontSize: 11 }}></span>}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{b.recipe_id ? (recipes.find(r => r.id === b.recipe_id)?.nome || '—') : '—'}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>{b.data_produzione} <span style={{ color: 'var(--text3)' }}>{(b.ora_produzione || '').slice(0, 5)}</span></td>
                  <td style={{ ...S.td, color: isScaduto ? '#EF4444' : (giorniMancanti != null && giorniMancanti <= 1 ? '#F59E0B' : '#94a3b8') }}>
                    {b.data_scadenza || '—'}
                    {giorniMancanti != null && b.stato === 'attivo' && (
                      <div style={{ fontSize: 10 }}>{giorniMancanti < 0 ? `${Math.abs(giorniMancanti)}gg fa` : giorniMancanti === 0 ? 'OGGI' : `${giorniMancanti}gg`}</div>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 11 }}>
                    {b.locale_produzione}
                    {b.locale_destinazione && b.locale_destinazione !== b.locale_produzione && (
                      <div style={{ color: 'var(--text3)' }}>{b.locale_destinazione}</div>
                    )}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{b.quantita_prodotta} {b.unita || ''}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>
                    {b.durata_minuti != null ? `${b.durata_minuti} min` : '—'}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>{b.operatore_nome || '—'}</td>
                  <td style={S.td}>
                    {anomalie.length === 0 ? (
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {anomalie.map((a, i) => (
                          <span key={i} title={a.label} style={{ ...S.badge('#F59E0B', 'rgba(245,158,11,.12)'), fontSize: 10 }}>
                            {a.tipo}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={S.td}>
                    {b.stato === 'attivo' && <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Attivo</span>}
                    {b.stato === 'consumato' && <span style={S.badge('#3B82F6', 'rgba(59,130,246,.12)')}>Consumato</span>}
                    {b.stato === 'scaduto' && <span style={S.badge('#EF4444', 'rgba(239,68,68,.12)')}>Scaduto</span>}
                    {b.stato === 'annullato' && <span style={S.badge('#64748b', 'rgba(100,116,139,.12)')}>Annullato</span>}
                  </td>
                  <td style={S.td}>
                    <button onClick={() => printEtichetta([b], recipes.find(r => r.id === b.recipe_id))}
                      style={{ background: 'none', border: '1px solid var(--border)', color: '#3B82F6', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', marginRight: 4 }}
                      title="Stampa etichetta PDF (1 lotto)"></button>
                    {b.stato !== 'annullato' && (
                      <button onClick={() => annulla(b)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }} title="Annulla lotto"></button>
                    )}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </>}

    {creating && <NuovoLotto recipes={recipes} allLocali={allLocali}
      onClose={() => setCreating(null)}
      onCreated={(batch, recipe) => {
        setCreating(null)
        load()
        // Auto-stampa etichetta dopo creazione
        setTimeout(() => printEtichetta([batch], recipe), 300)
      }} />}
  </Card>
}

function NuovoLotto({ recipes, allLocali, onClose, onCreated }) {
  const [recipeId, setRecipeId] = useState('')
  const [qty, setQty] = useState('')
  const [unita, setUnita] = useState('')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [oraOra, setOraOra] = useState(new Date().toTimeString().slice(0, 5))
  const [scadenza, setScadenza] = useState('')
  const [localeProd, setLocaleProd] = useState(allLocali[0] || '')
  const [localeDest, setLocaleDest] = useState('')
  const [operatoreNome, setOperatoreNome] = useState('')
  const [note, setNote] = useState('')
  const [employees, setEmployees] = useState([])
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const recipe = recipes.find(r => r.id === recipeId)

  // Carica dipendenti per autocomplete operatore
  useEffect(() => {
    supabase.from('employees').select('id,nome,locale').eq('stato', 'Attivo').order('nome')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  // Quando cambio ricetta, precompilo i campi
  useEffect(() => {
    if (!recipe) return
    setUnita(recipe.resa_unita || '')
    setLocaleProd(recipe.locale_produzione || allLocali[0] || '')
    setLocaleDest(recipe.locale_destinazione || '')
    if (recipe.resa_quantita) setQty(String(recipe.resa_quantita))
    if (recipe.shelf_life_days) {
      const sc = new Date(data); sc.setDate(sc.getDate() + Number(recipe.shelf_life_days))
      setScadenza(sc.toISOString().slice(0, 10))
    }
  }, [recipeId])

  // Aggiorna scadenza quando cambia data o shelf life della ricetta
  useEffect(() => {
    if (!recipe?.shelf_life_days) return
    const sc = new Date(data); sc.setDate(sc.getDate() + Number(recipe.shelf_life_days))
    setScadenza(sc.toISOString().slice(0, 10))
  }, [data, recipe?.shelf_life_days])

  const submit = async () => {
    setErr('')
    if (!recipe) { setErr('Scegli una scheda'); return }
    if (!qty || Number(qty) <= 0) { setErr('Quantità prodotta non valida'); return }
    if (!localeProd) { setErr('Locale di produzione richiesto'); return }
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const lotto = await generateLottoCode(user.id)

      // Calcola ingredienti scalati alla quantità prodotta vs resa attesa
      const ratio = recipe.resa_quantita ? Number(qty) / Number(recipe.resa_quantita) : 1
      const ingredientiUsati = (recipe.ingredienti || []).map(i => ({
        nome_articolo: i.nome_articolo,
        quantita: Math.round((Number(i.quantita) || 0) * ratio * 1000) / 1000,
        unita: i.unita || '',
      }))

      // 1. Crea il batch
      const { data: insBatch, error: insErr } = await supabase.from('production_batches').insert({
        user_id: user.id,
        recipe_id: recipe.id,
        lotto,
        data_produzione: data,
        ora_produzione: oraOra + ':00',
        data_scadenza: scadenza || null,
        locale_produzione: localeProd,
        locale_destinazione: localeDest || localeProd,
        operatore_nome: operatoreNome || null,
        quantita_prodotta: Number(qty),
        unita,
        ingredienti_usati: ingredientiUsati,
        allergeni: recipe.allergeni || [],
        conservazione: recipe.conservazione || null,
        note: note || null,
        stato: 'attivo',
      }).select().single()
      if (insErr) throw insErr

      // 2. Movimenti magazzino: scarico ingredienti + carico prodotto finito
      // Scarico ogni ingrediente dal locale di produzione
      for (const ing of ingredientiUsati) {
        if (!ing.nome_articolo || !ing.quantita) continue
        try {
          await applyMovement({
            locale: localeProd, subLocation: 'principale',
            nomeArticolo: ing.nome_articolo,
            tipo: 'scarico', quantita: ing.quantita, unita: ing.unita,
            fonte: 'produzione', riferimentoId: insBatch.id,
            riferimentoLabel: `Produzione ${recipe.nome} · lotto ${lotto}`,
          })
        } catch (e) {
          console.warn('[produzione scarico]', ing.nome_articolo, e.message)
        }
      }
      // Carico del prodotto finito sul locale di destinazione
      const localeFinale = localeDest || localeProd
      try {
        await applyMovement({
          locale: localeFinale, subLocation: 'principale',
          nomeArticolo: recipe.nome,
          tipo: 'carico', quantita: Number(qty), unita,
          fonte: 'produzione', riferimentoId: insBatch.id,
          riferimentoLabel: `Lotto ${lotto}`,
        })
      } catch (e) {
        console.warn('[produzione carico]', recipe.nome, e.message)
      }

      // Aggiorna batch con production_batch_id sui movimenti appena creati
      await supabase.from('article_movement')
        .update({ production_batch_id: insBatch.id })
        .eq('riferimento_id', insBatch.id).is('production_batch_id', null)

      onCreated(insBatch, recipe)
    } catch (e) { setErr(e.message); setCreating(false) }
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 640 }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>+ Nuovo lotto produzione</h3>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>Crea un lotto: scarica ingredienti, carica prodotto, stampa etichetta</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      <div style={{ padding: 20 }}>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Scheda produzione</div>
          <select value={recipeId} onChange={e => setRecipeId(e.target.value)} style={{ ...iS, width: '100%' }}>
            <option value="">— scegli scheda —</option>
            {recipes.map(r => <option key={r.id} value={r.id}>{r.nome} ({r.locale_produzione})</option>)}
          </select>
        </label>

        {recipe && <>
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12 }}>
            <div style={{ color: 'var(--text2)', marginBottom: 6 }}>Da scheda:</div>
            <div><strong>{recipe.ingredienti?.length || 0} ingredienti</strong> · resa attesa: <strong>{recipe.resa_quantita} {recipe.resa_unita}</strong> · shelf life: <strong>{recipe.shelf_life_days}gg</strong></div>
            {recipe.allergeni?.length > 0 && (
              <div style={{ marginTop: 6 }}>Allergeni: {recipe.allergeni.map(a => ALLERGENI_BY_KEY[a]?.l || a).join(', ')}</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Quantità prodotta</div>
              <input type="number" step="0.001" value={qty} onChange={e => setQty(e.target.value)} style={{ ...iS, width: '100%' }} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>UM</div>
              <select value={unita} onChange={e => setUnita(e.target.value)} style={{ ...iS, width: '100%' }}>
                {['', 'KG', 'GR', 'LT', 'ML', 'PZ', 'PORZIONI'].map(u => <option key={u} value={u}>{u || '—'}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Data produzione</div>
              <input type="date" value={data} onChange={e => setData(e.target.value)} style={{ ...iS, width: '100%' }} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Ora</div>
              <input type="time" value={oraOra} onChange={e => setOraOra(e.target.value)} style={{ ...iS, width: '100%' }} />
            </label>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Scadenza</div>
              <input type="date" value={scadenza} onChange={e => setScadenza(e.target.value)} style={{ ...iS, width: '100%' }} />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Locale produzione</div>
              <select value={localeProd} onChange={e => setLocaleProd(e.target.value)} style={{ ...iS, width: '100%' }}>
                {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Locale destinazione</div>
              <select value={localeDest} onChange={e => setLocaleDest(e.target.value)} style={{ ...iS, width: '100%' }}>
                <option value="">— uguale a produzione —</option>
                {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Operatore (chi sta producendo)</div>
            <input list="emp-list" value={operatoreNome} onChange={e => setOperatoreNome(e.target.value)}
              placeholder="Nome dipendente" style={{ ...iS, width: '100%' }} />
            <datalist id="emp-list">
              {employees.map(e => <option key={e.id} value={e.nome} />)}
            </datalist>
          </label>

          <label style={{ display: 'block', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Note (opz.)</div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Es. sostituito panna con mascarpone, doppia dose..." style={{ ...iS, width: '100%' }} />
          </label>

          {err && <div style={{ color: '#EF4444', fontSize: 12, marginBottom: 10 }}>{err}</div>}

          <div style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 6, padding: 10, fontSize: 11, color: '#F59E0B', marginBottom: 14 }}>
            Confermando il lotto: <br/>
            • Verranno scaricati gli ingredienti dal magazzino di {localeProd}<br/>
            • Verrà caricato il prodotto finito sul magazzino di {localeDest || localeProd}<br/>
            • Verrà generato un codice lotto univoco e l'etichetta PDF
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} disabled={creating} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
            <button onClick={submit} disabled={creating}
              style={{ ...iS, background: '#10B981', color: 'var(--text)', border: 'none', padding: '8px 20px', fontWeight: 700, cursor: creating ? 'wait' : 'pointer' }}>
              {creating ? 'Creo lotto…' : 'Conferma e crea lotto'}
            </button>
          </div>
        </>}
      </div>
    </div>
  </div>
}

// ─── Etichetta PDF A4 multi-lotto ───────────────────────────────
// Genera un PDF A4 con N etichette per pagina (8 etichette su griglia 2x4),
// una per lotto. Apre la finestra di stampa del browser (window.print).
async function printEtichetta(batches, recipe) {
  if (!batches || batches.length === 0) return
  // Genera QR per ogni batch
  const qrs = await Promise.all(batches.map(async b => {
    const url = window.location.origin + '/lotto/' + encodeURIComponent(b.lotto)
    try {
      return await QRCode.toDataURL(url, { width: 200, margin: 1, errorCorrectionLevel: 'M' })
    } catch { return null }
  }))

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const allergLabel = (b) => (b.allergeni || []).map(a => (ALLERGENI_BY_KEY[a]?.l || a).toUpperCase()).join(', ')

  const cards = batches.map((b, i) => `
    <div class="lab">
      <div class="head">
        <div class="nome">${escHtml(b.recipe_id ? (recipe?.nome || '') : '')}</div>
        <div class="lot">Lotto: <strong>${escHtml(b.lotto)}</strong></div>
      </div>
      <div class="dates">
        <div><span class="k">Prod.:</span> <strong>${escHtml(b.data_produzione)}</strong></div>
        <div><span class="k">Scad.:</span> <strong>${escHtml(b.data_scadenza || '—')}</strong></div>
      </div>
      <div class="ingr">
        <span class="k">Ingredienti:</span> ${escHtml((b.ingredienti_usati || []).map(i => i.nome_articolo).join(', '))}
      </div>
      ${(b.allergeni || []).length > 0 ? `<div class="allerg"><span class="k">Allergeni:</span> <strong>${escHtml(allergLabel(b))}</strong></div>` : ''}
      ${b.conservazione ? `<div class="cons"><span class="k">Conservazione:</span> ${escHtml(b.conservazione)}</div>` : ''}
      <div class="footer">
        <div class="loc">${escHtml(b.locale_produzione)}${b.locale_destinazione && b.locale_destinazione !== b.locale_produzione ? ' ' + escHtml(b.locale_destinazione) : ''}</div>
        ${qrs[i] ? `<img src="${qrs[i]}" class="qr"/>` : ''}
      </div>
    </div>
  `).join('')

  const html = `<!DOCTYPE html><html><head><title>Etichette Produzione</title><style>
    @page { size: A4; margin: 8mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; color: #111; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
    .lab { border: 1px solid #333; border-radius: 4px; padding: 6mm; height: 65mm; overflow: hidden; page-break-inside: avoid; display: flex; flex-direction: column; gap: 2mm; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 4mm; }
    .nome { font-size: 14px; font-weight: 700; line-height: 1.2; max-width: 70%; }
    .lot { font-size: 10px; }
    .dates { display: flex; gap: 6mm; font-size: 11px; }
    .ingr, .allerg, .cons { font-size: 9px; line-height: 1.3; }
    .allerg strong { text-transform: uppercase; }
    .k { color: #555; }
    .footer { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 4mm; font-size: 9px; }
    .loc { color: #555; }
    .qr { width: 22mm; height: 22mm; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style></head><body><div class="grid">${cards}</div></body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Popup bloccato — abilita i popup per stampare l\'etichetta.'); return }
  w.document.write(html); w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 400)
}

// ─── TRACCIABILITÀ ──────────────────────────────────────────────
// Cerca un lotto, mostra: scheda origine, ingredienti usati con
// lotti origine fattura (one step back), movimenti magazzino
// generati dal batch (one step forward = dove sono finiti i prodotti).
function TracciabilitaTab({ sp, sps }) {
  const [search, setSearch] = useState('')
  const [batches, setBatches] = useState([])
  const [selected, setSelected] = useState(null)
  const [movements, setMovements] = useState([])
  const [origini, setOrigini] = useState({}) // nome_articolo [{fattura, fornitore, data}]
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('production_batches')
      .select('*').order('created_at', { ascending: false }).limit(100)
    setBatches(data || [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const openBatch = async (b) => {
    setSelected(b)
    // Movimenti generati dal batch (carico prodotto + scarichi ingredienti)
    const { data: movs } = await supabase.from('article_movement')
      .select('*').eq('production_batch_id', b.id).order('created_at')
    setMovements(movs || [])
    // Origini ingredienti: per ogni ingrediente cerco le fatture recenti (last 90gg) dello stesso locale
    const origs = {}
    for (const ing of (b.ingredienti_usati || [])) {
      if (!ing.nome_articolo) continue
      const { data: items } = await supabase.from('warehouse_invoice_items')
        .select('warehouse_invoices!inner(data,fornitore,locale,numero)')
        .eq('nome_articolo', ing.nome_articolo)
        .eq('warehouse_invoices.locale', b.locale_produzione)
        .lte('warehouse_invoices.data', b.data_produzione)
        .order('warehouse_invoices(data)', { ascending: false })
        .limit(3)
      origs[ing.nome_articolo] = (items || []).map(it => it.warehouse_invoices).filter(Boolean)
    }
    setOrigini(origs)
  }

  const filtered = batches.filter(b => {
    if (!search) return true
    const s = search.toLowerCase()
    return b.lotto.toLowerCase().includes(s)
      || (b.operatore_nome || '').toLowerCase().includes(s)
      || (b.locale_produzione || '').toLowerCase().includes(s)
  })

  return <Card title="Tracciabilità lotti" badge={loading ? '...' : `${filtered.length} lotti`}>
    <input value={search} onChange={e => setSearch(e.target.value)}
      placeholder="Cerca lotto (es. P-20260503-001)…"
      style={{ ...iS, width: '100%', marginBottom: 12 }} />

    {loading ? (
      <div style={{ padding: 24, color: 'var(--text3)', textAlign: 'center' }}>Caricamento…</div>
    ) : filtered.length === 0 ? (
      <div style={{ padding: 30, color: 'var(--text3)', textAlign: 'center', fontSize: 13 }}>
        Nessun lotto trovato. Crea un primo lotto nella tab "Lotti".
      </div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        {/* Lista lotti */}
        <div style={{ maxHeight: 540, overflowY: 'auto', borderRight: '1px solid var(--border)', paddingRight: 8 }}>
          {filtered.map(b => {
            const sel = selected?.id === b.id
            return <button key={b.id} onClick={() => openBatch(b)}
              style={{ width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 4,
                background: sel ? 'rgba(59,130,246,.12)' : '#131825',
                border: `1px solid ${sel ? '#3B82F6' : '#2a3042'}`,
                borderRadius: 8, cursor: 'pointer', color: 'var(--text)' }}>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: '#3B82F6' }}>{b.lotto}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{b.data_produzione} · {b.locale_produzione}</div>
            </button>
          })}
        </div>

        {/* Dettaglio + timeline */}
        <div style={{ maxHeight: 540, overflowY: 'auto' }}>
          {!selected ? (
            <div style={{ padding: 30, color: 'var(--text3)', textAlign: 'center', fontSize: 12 }}>
              Seleziona un lotto per vedere la tracciabilità
            </div>
          ) : <>
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#3B82F6', fontSize: 14 }}>{selected.lotto}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                {selected.data_produzione} {(selected.ora_produzione || '').slice(0, 5)} · {selected.locale_produzione}
                {selected.locale_destinazione && selected.locale_destinazione !== selected.locale_produzione && ` ${selected.locale_destinazione}`}
              </div>
              <div style={{ fontSize: 12, marginTop: 6 }}>{selected.quantita_prodotta} {selected.unita || ''} prodotti{selected.operatore_nome ? ` · ${selected.operatore_nome}` : ''}</div>
            </div>

            {/* ONE STEP BACK: ingredienti origine */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#10B981', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                Ingredienti origine (one step back)
              </div>
              {(selected.ingredienti_usati || []).length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Nessun ingrediente registrato.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Articolo', 'Quantità', 'Ultima fattura'].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(selected.ingredienti_usati || []).map((i, idx) => {
                      const orig = origini[i.nome_articolo] || []
                      const last = orig[0]
                      return <tr key={idx} style={{ borderBottom: '1px solid #1a1f2e' }}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{i.nome_articolo}</td>
                        <td style={{ ...S.td }}>{i.quantita} {i.unita || ''}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>
                          {last ? <>{last.data} · {last.fornitore}{last.numero ? ` (#${last.numero})` : ''}</> : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      </tr>
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ONE STEP FORWARD: movimenti magazzino generati */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                Movimenti generati (one step forward)
              </div>
              {movements.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>Nessun movimento collegato.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Tipo', 'Articolo', 'Quantità', 'Locale'].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {movements.map(m => {
                      const colorByTipo = { carico: '#10B981', scarico: '#EF4444', trasferimento_out: '#8B5CF6', trasferimento_in: '#06B6D4' }
                      return <tr key={m.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                        <td style={S.td}>
                          <span style={S.badge(colorByTipo[m.tipo] || '#94a3b8', (colorByTipo[m.tipo] || '#94a3b8') + '22')}>{m.tipo}</span>
                        </td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{m.nome_articolo}</td>
                        <td style={{ ...S.td }}>{Number(m.quantita).toFixed(2)} {m.unita || ''}</td>
                        <td style={{ ...S.td, fontSize: 11, color: 'var(--text2)' }}>{m.locale}{m.sub_location_target ? ` ${m.sub_location_target}` : ''}</td>
                      </tr>
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Link pagina pubblica */}
            <div style={{ marginTop: 16, padding: 10, background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 6, fontSize: 11 }}>
              Pagina pubblica del lotto:&nbsp;
              <a href={`/lotto/${encodeURIComponent(selected.lotto)}`} target="_blank" rel="noreferrer"
                style={{ color: '#3B82F6', fontFamily: 'monospace', textDecoration: 'underline' }}>
                /lotto/{selected.lotto}
              </a>
            </div>
          </>}
        </div>
      </div>
    )}
  </Card>
}
