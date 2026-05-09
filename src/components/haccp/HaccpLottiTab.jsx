// HACCP → Lotti produzione (vista read-only orientata alla tracciabilità HACCP)
// Sorgente: production_batches (gli stessi lotti tracciati in Magazzino → Produzione)
// Filtri: locale, stato, periodo, ricerca, data_scadenza imminente.
// Click su un lotto → modale con dettaglio + ingredienti + allergeni + conservazione + QR (per ispettori).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card } from '../shared/styles.jsx'

function fmtDate(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDT(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}
function daysTo(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr + 'T12:00:00')
  return Math.round((d - today) / 86400000)
}

const STATO_COLOR = {
  attivo: '#10B981',
  terminato: '#3B82F6',
  esaurito: '#3B82F6',
  scaduto: '#EF4444',
  annullato: '#64748B',
}
const STATO_LABEL = {
  attivo: 'Attivo',
  terminato: 'Terminato',
  esaurito: 'Terminato',
  scaduto: 'Scaduto',
  annullato: 'Annullato',
}

export default function HaccpLottiTab({ sps = [] }) {
  const [batches, setBatches] = useState([])
  const [recipes, setRecipes] = useState([])
  const [scaricoByBatch, setScaricoByBatch] = useState({}) // batch_id -> qty_scaricata totale
  const [loading, setLoading] = useState(true)
  const [openBatch, setOpenBatch] = useState(null)
  const [filterLocale, setFilterLocale] = useState('')
  const [filterStato, setFilterStato] = useState('')
  const [filterScad, setFilterScad] = useState('')
  const [search, setSearch] = useState('')
  const [periodoMese, setPeriodoMese] = useState(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  })

  const allLocali = useMemo(() => [...new Set((sps || []).map(s => s.description || s.name).filter(Boolean))], [sps])

  const load = useCallback(async () => {
    setLoading(true)
    const start = periodoMese + '-01'
    const [yy, mm] = periodoMese.split('-').map(Number)
    const endDate = new Date(yy, mm, 1)
    const end = endDate.toISOString().split('T')[0]
    const [b, r] = await Promise.all([
      supabase.from('production_batches')
        .select('*')
        .gte('data_produzione', start).lt('data_produzione', end)
        .order('created_at', { ascending: false }),
      supabase.from('production_recipes').select('id, nome, allergeni, conservazione').limit(500),
    ])
    const batchList = b.data || []
    setBatches(batchList)
    setRecipes(r.data || [])

    // Per ogni batch calcola la qty scaricata totale (movimenti tipo='scarico')
    // associati via production_batch_id. Permette di determinare se il lotto e'
    // terminato/venduto vs ancora attivo.
    const ids = batchList.map(x => x.id)
    const scarichi = {}
    if (ids.length > 0) {
      const { data: movs } = await supabase.from('article_movement')
        .select('production_batch_id, tipo, quantita')
        .in('production_batch_id', ids)
        .eq('tipo', 'scarico')
      for (const m of (movs || [])) {
        const k = m.production_batch_id; if (!k) continue
        scarichi[k] = (scarichi[k] || 0) + (Number(m.quantita) || 0)
      }
    }
    setScaricoByBatch(scarichi)
    setLoading(false)
  }, [periodoMese])
  useEffect(() => { load() }, [load])

  const recipeById = useMemo(() => Object.fromEntries(recipes.map(r => [r.id, r])), [recipes])

  // Stato effettivo: priorita' 'annullato' > 'terminato' (qty scaricata >= prodotta)
  // > 'scaduto' (data passata) > 'attivo'.
  // Nota: 'terminato' batte 'scaduto' perche' un lotto venduto in tempo non e'
  // davvero scaduto, e' solo gia' uscito dal magazzino.
  const effectiveStatus = useCallback((b) => {
    if (b.stato === 'annullato') return 'annullato'
    const qtyProd = Number(b.quantita_prodotta) || 0
    const qtyOut = Number(scaricoByBatch[b.id]) || 0
    // tolleranza 0.001 per arrotondamenti unita' di misura
    if (qtyProd > 0 && qtyOut >= qtyProd - 0.001) return 'terminato'
    if (b.data_scadenza) {
      const today = new Date(); today.setHours(0,0,0,0)
      const d = new Date(b.data_scadenza + 'T12:00:00')
      if (d < today) return 'scaduto'
    }
    return 'attivo'
  }, [scaricoByBatch])

  const filtered = useMemo(() => batches.filter(b => {
    if (filterLocale && b.locale_produzione !== filterLocale && b.locale_destinazione !== filterLocale) return false
    if (filterStato) {
      const eff = effectiveStatus(b)
      if (filterStato === 'esaurito' || filterStato === 'terminato') {
        if (eff !== 'terminato') return false
      } else if (eff !== filterStato) return false
    }
    if (search) {
      const r = recipeById[b.recipe_id]
      const haystack = `${b.lotto} ${r?.nome || ''} ${b.operatore_nome || ''}`.toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    const dt = daysTo(b.data_scadenza)
    if (filterScad === 'scaduti' && (dt == null || dt >= 0)) return false
    if (filterScad === 'in_scadenza' && (dt == null || dt < 0 || dt > 7)) return false
    if (filterScad === 'attivi' && (dt != null && dt < 0)) return false
    return true
  }), [batches, filterLocale, filterStato, filterScad, search, recipeById, effectiveStatus])

  const stats = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    let attivi = 0, scaduti = 0, in_scadenza_7gg = 0, annullati = 0, terminati = 0
    for (const b of batches) {
      const eff = effectiveStatus(b)
      if (eff === 'annullato') { annullati++; continue }
      if (eff === 'terminato') { terminati++; continue }
      if (eff === 'scaduto') { scaduti++; continue }
      // attivo: distingui in scadenza 7gg
      if (b.data_scadenza) {
        const d = new Date(b.data_scadenza + 'T12:00:00')
        const diff = Math.round((d - today) / 86400000)
        if (diff <= 7) in_scadenza_7gg++
        else attivi++
      } else attivi++
    }
    return { tot: batches.length, attivi, terminati, scaduti, in_scadenza_7gg, annullati }
  }, [batches, effectiveStatus])

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <KPI label="Totale lotti (mese)" value={stats.tot} accent="#3B82F6"/>
      <KPI label="Attivi" value={stats.attivi} accent="#10B981"/>
      <KPI label="In scadenza (7gg)" value={stats.in_scadenza_7gg} accent="#F59E0B" onClick={() => setFilterScad('in_scadenza')}/>
      <KPI label="Terminati" value={stats.terminati} accent="#3B82F6" onClick={() => setFilterStato('terminato')}/>
      <KPI label="Scaduti" value={stats.scaduti} accent="#EF4444" onClick={() => setFilterStato('scaduto')}/>
      <KPI label="Annullati" value={stats.annullati} accent="var(--text3)"/>
    </div>

    <Card title="Tracciabilità lotti produzione" badge={loading ? '…' : (filtered.length + ' di ' + batches.length)}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <input placeholder="Cerca codice lotto, ricetta, operatore…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...S.input, fontSize: 12, padding: '6px 10px', flex: '1 1 200px', minWidth: 180 }}/>
        <input type="month" value={periodoMese} onChange={e => setPeriodoMese(e.target.value)}
          style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}/>
        {allLocali.length > 0 && <select value={filterLocale} onChange={e => setFilterLocale(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti i locali</option>
          {allLocali.map(l => <option key={l} value={l}>{l}</option>)}
        </select>}
        <select value={filterStato} onChange={e => setFilterStato(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Tutti gli stati</option>
          <option value="attivo">Attivo</option>
          <option value="terminato">Terminato</option>
          <option value="scaduto">Scaduto</option>
          <option value="annullato">Annullato</option>
        </select>
        <select value={filterScad} onChange={e => setFilterScad(e.target.value)} style={{ ...S.input, fontSize: 12, padding: '6px 10px' }}>
          <option value="">Qualsiasi scadenza</option>
          <option value="attivi">Non scaduti</option>
          <option value="in_scadenza">Entro 7gg</option>
          <option value="scaduti">Scaduti</option>
        </select>
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)' }}>Caricamento…</div>}
      {!loading && filtered.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
        {batches.length === 0 ? 'Nessun lotto in questo mese.' : 'Nessun lotto con questi filtri.'}
      </div>}

      {!loading && filtered.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Lotto', 'Prodotto', 'Quantità', 'Locale', 'Operatore', 'Data prod.', 'Scadenza', 'Stato'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(b => {
              const r = recipeById[b.recipe_id]
              const dt = daysTo(b.data_scadenza)
              let scadColor = 'var(--text3)', scadLabel = '—', scadBg = 'transparent'
              if (b.data_scadenza) {
                if (dt < 0) { scadColor = '#EF4444'; scadLabel = `Scaduto ${Math.abs(dt)}gg fa`; scadBg = 'rgba(239,68,68,.1)' }
                else if (dt <= 3) { scadColor = '#EF4444'; scadLabel = `${dt}gg`; scadBg = 'rgba(239,68,68,.1)' }
                else if (dt <= 7) { scadColor = '#F59E0B'; scadLabel = `${dt}gg`; scadBg = 'rgba(245,158,11,.1)' }
                else { scadColor = '#10B981'; scadLabel = `${dt}gg` }
              }
              const eff = effectiveStatus(b)
              const statoColor = STATO_COLOR[eff] || 'var(--text3)'
              const qtyOut = Number(scaricoByBatch[b.id]) || 0
              const qtyProd = Number(b.quantita_prodotta) || 0
              const pctOut = qtyProd > 0 ? Math.min(100, Math.round(qtyOut / qtyProd * 100)) : 0
              return <tr key={b.id} onClick={() => setOpenBatch(b)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{b.lotto}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  {r?.nome || <span style={{ color: 'var(--text3)' }}>?</span>}
                  {b.allergeni?.length > 0 && <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600, marginTop: 2 }}>⚠ {b.allergeni.join(', ')}</div>}
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>{b.quantita_prodotta} {b.unita || ''}</td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {b.locale_produzione}
                  {b.locale_destinazione && b.locale_destinazione !== b.locale_produzione &&
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>→ {b.locale_destinazione}</div>}
                </td>
                <td style={{ ...S.td, fontSize: 12, color: 'var(--text2)' }}>{b.operatore_nome || '—'}</td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {fmtDate(b.data_produzione)}
                  {b.ora_produzione && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{(b.ora_produzione || '').slice(0,5)}</div>}
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {b.data_scadenza ? <>
                    <div>{fmtDate(b.data_scadenza)}</div>
                    <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, background: scadBg, color: scadColor, fontSize: 10, fontWeight: 700, marginTop: 2 }}>{scadLabel}</span>
                  </> : <span style={{ color: 'var(--text3)' }}>—</span>}
                </td>
                <td style={{ ...S.td }}>
                  <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 4, background: statoColor + '22', color: statoColor, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{STATO_LABEL[eff] || eff}</span>
                  {eff === 'attivo' && qtyProd > 0 && qtyOut > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{pctOut}% scaricato</div>}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>}
    </Card>

    {openBatch && <BatchDetailModal batch={openBatch} recipe={recipeById[openBatch.recipe_id]}
      effectiveStato={effectiveStatus(openBatch)}
      qtyScaricata={Number(scaricoByBatch[openBatch.id]) || 0}
      onClose={() => setOpenBatch(null)}/>}
  </div>
}

function KPI({ label, value, accent, onClick }) {
  return <div onClick={onClick} style={{
    background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid ' + accent,
    borderRadius: 8, padding: 12, cursor: onClick ? 'pointer' : 'default',
  }}>
    <div style={{ fontSize: 22, fontWeight: 700, color: accent === 'var(--text3)' ? 'var(--text2)' : accent, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
  </div>
}

function BatchDetailModal({ batch, recipe, effectiveStato, qtyScaricata, onClose }) {
  const [movs, setMovs] = useState([])
  const [loadingMovs, setLoadingMovs] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('article_movement')
        .select('id, tipo, nome_articolo, quantita, unita, locale, sub_location, riferimento_label, created_at')
        .eq('production_batch_id', batch.id)
        .order('created_at', { ascending: true })
      if (!cancelled) { setMovs(data || []); setLoadingMovs(false) }
    })()
    return () => { cancelled = true }
  }, [batch.id])

  const ingredientiUsati = batch.ingredienti_usati || []
  const allergeni = batch.allergeni && batch.allergeni.length > 0 ? batch.allergeni : (recipe?.allergeni || [])

  return <div onClick={onClose} className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: 16, overflow: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, maxWidth: 720, width: '100%', boxShadow: 'var(--shadow-md)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>Lotto <span style={{ fontFamily: 'monospace', color: '#3B82F6' }}>{batch.lotto}</span></h3>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{recipe?.nome || '—'}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--text2)', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Section label="Tracciabilità">
          <Row label="Quantità prodotta" value={`${batch.quantita_prodotta} ${batch.unita || ''}`}/>
          <Row label="Data produzione" value={`${fmtDate(batch.data_produzione)}${batch.ora_produzione ? ' ore ' + batch.ora_produzione.slice(0,5) : ''}`}/>
          <Row label="Locale produzione" value={batch.locale_produzione}/>
          <Row label="Locale destinazione" value={batch.locale_destinazione || batch.locale_produzione}/>
          <Row label="Operatore" value={batch.operatore_nome || '—'}/>
          <Row label="Data scadenza" value={batch.data_scadenza ? fmtDate(batch.data_scadenza) : 'Non specificata'}/>
          <Row label="Conservazione" value={batch.conservazione || recipe?.conservazione || '—'}/>
          <Row label="Stato" value={<span style={{ color: STATO_COLOR[effectiveStato] || 'var(--text3)', fontWeight: 700 }}>{STATO_LABEL[effectiveStato] || effectiveStato}</span>}/>
          {qtyScaricata > 0 && <Row label="Quantità scaricata" value={`${qtyScaricata} ${batch.unita || ''} (${Math.min(100, Math.round(qtyScaricata / (Number(batch.quantita_prodotta) || 1) * 100))}%)`}/>}
          {batch.note && <Row label="Note" value={batch.note}/>}
        </Section>

        {allergeni.length > 0 && <Section label="Allergeni">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {allergeni.map(a => <span key={a} style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 4, background: 'rgba(245,158,11,.15)', color: '#F59E0B', fontSize: 12, fontWeight: 600 }}>⚠ {a}</span>)}
          </div>
        </Section>}

        {ingredientiUsati.length > 0 && <Section label={`Ingredienti utilizzati (${ingredientiUsati.length})`}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Articolo', 'Quantità'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {ingredientiUsati.map((i, idx) => <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...S.td }}>{i.nome_articolo}</td>
                <td style={{ ...S.td, color: 'var(--text2)' }}>{i.quantita} {i.unita || ''}</td>
              </tr>)}
            </tbody>
          </table>
        </Section>}

        <Section label={`Movimenti magazzino collegati ${loadingMovs ? '…' : '(' + movs.length + ')'}`}>
          {!loadingMovs && movs.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 12, fontStyle: 'italic' }}>Nessun movimento collegato.</div>}
          {movs.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Quando', 'Tipo', 'Articolo', 'Qtà', 'Locale'].map(h => <th key={h} style={{ ...S.th, fontSize: 10 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {movs.map(m => <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...S.td, fontSize: 11 }}>{fmtDT(m.created_at)}</td>
                <td style={{ ...S.td }}>
                  <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                    background: (m.tipo === 'carico' ? '#10B981' : '#EF4444') + '22',
                    color: m.tipo === 'carico' ? '#10B981' : '#EF4444',
                  }}>{m.tipo}</span>
                </td>
                <td style={{ ...S.td }}>{m.nome_articolo}</td>
                <td style={{ ...S.td }}>{m.quantita} {m.unita || ''}</td>
                <td style={{ ...S.td, color: 'var(--text2)' }}>{m.locale}</td>
              </tr>)}
            </tbody>
          </table>}
        </Section>

        <div style={{ background: 'rgba(59,130,246,.08)', border: '1px dashed rgba(59,130,246,.3)', padding: 12, borderRadius: 8, fontSize: 12, color: 'var(--text2)' }}>
          <strong style={{ color: '#3B82F6' }}>Per ispezioni NAS / ASL:</strong> mostra questa schermata o stampa.
          Il codice lotto <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace' }}>{batch.lotto}</code> permette di rintracciare ingredienti, fornitori e movimenti.
        </div>
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => window.print()} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>🖨 Stampa</button>
        <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, background: 'var(--text)', color: 'var(--surface)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Chiudi</button>
      </div>
    </div>
  </div>
}

function Section({ label, children }) {
  return <div>
    <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{label}</div>
    {children}
  </div>
}

function Row({ label, value }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
    <span style={{ color: 'var(--text3)' }}>{label}</span>
    <span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{value}</span>
  </div>
}
