// Tab Produzione — HACCP / Etichettatura
// 3 sotto-tab: Schede produzione (template) · Lotti (esecuzioni) · Tracciabilità
//
// v1 (questo commit): solo Schede CRUD completo + auto-detect allergeni.
// Lotti e Tracciabilità sono placeholder per i prossimi commit.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

const iS = S.input

// 14 allergeni Reg. UE 1169/2011
export const ALLERGENI = [
  { v: 'glutine',         l: 'Glutine',          ico: '🌾' },
  { v: 'crostacei',       l: 'Crostacei',        ico: '🦐' },
  { v: 'uova',            l: 'Uova',             ico: '🥚' },
  { v: 'pesce',           l: 'Pesce',            ico: '🐟' },
  { v: 'arachidi',        l: 'Arachidi',         ico: '🥜' },
  { v: 'soia',            l: 'Soia',             ico: '🌱' },
  { v: 'latte',           l: 'Latte',            ico: '🥛' },
  { v: 'frutta_a_guscio', l: 'Frutta a guscio',  ico: '🌰' },
  { v: 'sedano',          l: 'Sedano',           ico: '🥬' },
  { v: 'senape',          l: 'Senape',           ico: '🌶️' },
  { v: 'sesamo',          l: 'Sesamo',           ico: '⚪' },
  { v: 'solfiti',         l: 'Solfiti',          ico: '🧪' },
  { v: 'lupini',          l: 'Lupini',           ico: '🟡' },
  { v: 'molluschi',       l: 'Molluschi',        ico: '🐚' },
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
  { k: 'schede',         l: '📋 Schede',         d: 'Template ricette di produzione' },
  { k: 'lotti',          l: '🏷️ Lotti',          d: 'Esecuzioni reali con etichette + QR' },
  { k: 'tracciabilita',  l: '🔍 Tracciabilità',  d: 'Origine ingredienti, dove sono finiti' },
]

export default function ProductionManager({ sp, sps }) {
  const [subTab, setSubTab] = useState(() => localStorage.getItem('production_tab') || 'schede')
  useEffect(() => { localStorage.setItem('production_tab', subTab) }, [subTab])

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
    {subTab === 'lotti' && <PlaceholderTab title="🏷️ Lotti produzione"
      msg="In arrivo: crea un lotto da una scheda → genera codice univoco, scarica ingredienti dal magazzino di produzione, carica il prodotto finito sul magazzino di destinazione, stampa etichetta PDF con QR code per tracciabilità ASL." />}
    {subTab === 'tracciabilita' && <PlaceholderTab title="🔍 Tracciabilità lotti"
      msg="In arrivo: cerca un lotto e vedi da quali ingredienti deriva (con i loro lotti origine fattura), dove è andato (trasferimenti), quali consumi/vendite hanno usato questo lotto." />}
  </>
}

function PlaceholderTab({ title, msg }) {
  return <Card title={title}>
    <div style={{ padding: 24, color: '#94a3b8', fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🚧</div>
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

  return <Card title="📋 Schede produzione" badge={`${filtered.length}/${recipes.length}`} extra={
    <button onClick={() => setEditing({
      nome: '', locale_produzione: allLocali[0] || '', locale_destinazione: '',
      ingredienti: [], procedimento: '', allergeni: [], conservazione: '+4°C frigo',
      shelf_life_days: 3, resa_quantita: '', resa_unita: 'KG', attivo: true,
    })}
      style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 700, border: 'none', padding: '6px 14px', cursor: 'pointer' }}>
      + Nuova scheda
    </button>
  }>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <input placeholder="🔍 Cerca scheda…" value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...iS, flex: 1, minWidth: 200 }} />
      <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={iS}>
        <option value="">Tutti i locali</option>
        {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
    </div>

    {loading ? (
      <div style={{ padding: 24, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
    ) : recipes.length === 0 ? (
      <div style={{ padding: 30, color: '#64748b', textAlign: 'center', lineHeight: 1.6 }}>
        Nessuna scheda produzione.<br/>
        <span style={{ fontSize: 12 }}>
          Le schede sono i "template" delle preparazioni interne (es. tiramisù, farinata, salse).<br/>
          Da una scheda potrai poi creare i lotti reali con etichette HACCP.
        </span>
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome', 'Produzione', 'Destinazione', 'Resa', 'Conservazione', 'Shelf life', 'Allergeni', 'Stato', ''].map(h =>
              <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} onClick={() => setEditing(r)}
                style={{ borderBottom: '1px solid #1a1f2e', cursor: 'pointer' }}>
                <td style={{ ...S.td, fontWeight: 600, color: '#3B82F6' }}>{r.nome}</td>
                <td style={S.td}>{r.locale_produzione}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{r.locale_destinazione || '—'}</td>
                <td style={S.td}>{r.resa_quantita ? `${r.resa_quantita} ${r.resa_unita || ''}` : '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 11 }}>{r.conservazione || '—'}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{r.shelf_life_days ? r.shelf_life_days + 'gg' : '—'}</td>
                <td style={S.td}>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {(r.allergeni || []).slice(0, 5).map(a => {
                      const meta = ALLERGENI_BY_KEY[a]
                      return meta ? <span key={a} title={meta.l} style={{ fontSize: 11 }}>{meta.ico}</span> : null
                    })}
                    {(r.allergeni || []).length > 5 && <span style={{ color: '#64748b', fontSize: 10 }}>+{(r.allergeni || []).length - 5}</span>}
                    {(r.allergeni || []).length === 0 && <span style={{ color: '#475569', fontSize: 10 }}>—</span>}
                  </div>
                </td>
                <td style={S.td}>
                  {r.attivo
                    ? <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Attiva</span>
                    : <span style={S.badge('#64748b', 'rgba(100,116,139,.12)')}>Off</span>}
                </td>
                <td style={S.td} onClick={e => e.stopPropagation()}>
                  <button onClick={() => duplicate(r)} style={{ background: 'none', border: '1px solid #2a3042', color: '#94a3b8', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', marginRight: 4 }}>Dup</button>
                  <button onClick={() => remove(r)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>✕</button>
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
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 760 }}>
      <div style={{ padding: 16, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{isNew ? '➕ Nuova scheda produzione' : '✎ ' + r.nome}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      <div style={{ padding: 20 }}>
        {/* Anagrafica */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Nome</div>
            <input value={r.nome || ''} onChange={e => update('nome', e.target.value)} placeholder="es. Tiramisù" style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Locale produzione</div>
            <select value={r.locale_produzione || ''} onChange={e => update('locale_produzione', e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="">—</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Locale destinazione (opz.)</div>
            <select value={r.locale_destinazione || ''} onChange={e => update('locale_destinazione', e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="">— uguale a produzione —</option>
              {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Resa quantità</div>
            <input type="number" step="0.001" value={r.resa_quantita ?? ''} onChange={e => update('resa_quantita', e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>UM resa</div>
            <select value={r.resa_unita || ''} onChange={e => update('resa_unita', e.target.value)} style={{ ...iS, width: '100%' }}>
              {['KG', 'GR', 'LT', 'ML', 'PZ', 'PORZIONI'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Conservazione</div>
            <input value={r.conservazione || ''} onChange={e => update('conservazione', e.target.value)} placeholder="+4°C frigo" style={{ ...iS, width: '100%' }} />
          </label>
          <label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Shelf life (gg)</div>
            <input type="number" value={r.shelf_life_days ?? ''} onChange={e => update('shelf_life_days', e.target.value)} style={{ ...iS, width: '100%' }} />
          </label>
        </div>

        {/* Ingredienti */}
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Ingredienti ({(r.ingredienti || []).length})</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={autoDetectFromIngredients}
                style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                title="Rileva allergeni dai nomi degli ingredienti">
                🔍 Auto-allergeni
              </button>
              <button onClick={addIng}
                style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                + Ingrediente
              </button>
            </div>
          </div>
          {(r.ingredienti || []).length === 0 && (
            <div style={{ padding: 12, color: '#64748b', textAlign: 'center', fontSize: 12, border: '1px dashed #2a3042', borderRadius: 8 }}>
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
              <button onClick={() => rmIng(i)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </div>
          ))}
        </div>

        {/* Allergeni */}
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Allergeni dichiarati <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>(Reg. UE 1169/2011)</span>
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
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Procedimento (opz.)</div>
          <textarea value={r.procedimento || ''} onChange={e => update('procedimento', e.target.value)}
            placeholder="Es. 1) Montare i tuorli con lo zucchero. 2) Aggiungere il mascarpone. 3) Inzuppare i savoiardi nel caffè. CCP: temperatura conservazione +4°C max."
            rows={4} style={{ ...iS, width: '100%', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!r.attivo} onChange={e => update('attivo', e.target.checked)} />
          Scheda attiva (i dipendenti possono usarla per nuovi lotti)
        </label>

        {err && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 12 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a3042' }}>
          <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
          <button onClick={save} disabled={saving}
            style={{ ...iS, background: '#10B981', color: '#0f1420', border: 'none', padding: '8px 20px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Salvo…' : '💾 Salva scheda'}
          </button>
        </div>
      </div>
    </div>
  </div>
}
