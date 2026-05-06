// Giacenze v2 — articoli per locale e sub-location
//
// Legge article_stock. Somma per nome_articolo + locale (+ eventuale sub-location).
// Filtro sub-location (se il locale ne ha definite piu' di una).
// Click su articolo popup con storico movimenti + movimento manuale rapido.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, KPI, fmtD, fmtN } from '../shared/styles.jsx'
import {
  getSubLocationsMap, setSubLocations, subLocationsFor, applyMovement,
} from '../../lib/warehouse.js'

const iS = S.input

export default function StockView({ sp, sps }) {
  const [stock, setStock] = useState([])
  const [loading, setLoading] = useState(true)
  const [subMap, setSubMap] = useState({})
  const [selSub, setSelSub] = useState('all')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('tutti')
  const [selected, setSelected] = useState(null)
  const [showSubConfig, setShowSubConfig] = useState(false)
  const [showManualMove, setShowManualMove] = useState(false)

  const selectedLocaleName = (!sp || sp === 'all') ? null :
    (sps?.find(s => String(s.id) === String(sp))?.description || null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, map] = await Promise.all([
      (async () => {
        let q = supabase.from('article_stock').select('*').order('nome_articolo')
        if (selectedLocaleName) q = q.eq('locale', selectedLocaleName)
        return await q
      })(),
      getSubLocationsMap(),
    ])
    setStock(s || [])
    setSubMap(map)
    setLoading(false)
  }, [selectedLocaleName])

  useEffect(() => { load() }, [load])

  const subsForLocale = selectedLocaleName ? subLocationsFor(subMap, selectedLocaleName) : []

  const filtered = useMemo(() => {
    let list = stock
    if (selectedLocaleName && selSub !== 'all') list = list.filter(s => s.sub_location === selSub)
    if (search) list = list.filter(s => s.nome_articolo.toLowerCase().includes(search.toLowerCase()))
    if (filterType === 'sotto_scorta') list = list.filter(s =>
      s.scorta_minima != null && Number(s.quantita) < Number(s.scorta_minima))
    return list
  }, [stock, selSub, search, filterType, selectedLocaleName])

  const aggregated = useMemo(() => {
    if (selSub !== 'all' || !selectedLocaleName) return filtered
    const map = {}
    filtered.forEach(s => {
      const key = s.nome_articolo
      if (!map[key]) map[key] = { ...s, quantita: 0, sub_locations: [] }
      map[key].quantita = Math.round((Number(map[key].quantita) + Number(s.quantita || 0)) * 1000) / 1000
      if (s.quantita > 0) map[key].sub_locations.push(s.sub_location + ':' + s.quantita)
    })
    return Object.values(map)
  }, [filtered, selSub, selectedLocaleName])

  const valoreTot = aggregated.reduce((acc, s) =>
    acc + (Number(s.quantita || 0) * Number(s.prezzo_medio || 0)), 0)
  const sottoScorta = aggregated.filter(s =>
    s.scorta_minima != null && Number(s.quantita) < Number(s.scorta_minima)).length

  return <>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      {selectedLocaleName ? (
        <>
          <strong style={{ fontSize: 12, color: '#94a3b8' }}>{selectedLocaleName}</strong>
          {subsForLocale.length > 1 && (
            <select value={selSub} onChange={e => setSelSub(e.target.value)} style={iS}>
              <option value="all">Tutte le sub-location</option>
              {subsForLocale.map(sl => <option key={sl} value={sl}>{sl}</option>)}
            </select>
          )}
          <button onClick={() => setShowSubConfig(true)} style={{ ...iS, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
            Sub-location
          </button>
        </>
      ) : (
        <span style={{ fontSize: 12, color: '#64748b' }}>Seleziona un locale nell'header per filtrare</span>
      )}
      <input placeholder="Cerca articolo..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...iS, flex: 1, maxWidth: 260 }} />
      <select value={filterType} onChange={e => setFilterType(e.target.value)} style={iS}>
        <option value="tutti">Mostra tutti</option>
        <option value="sotto_scorta">Solo sotto scorta</option>
      </select>
      <button onClick={() => setShowManualMove(true)} disabled={!selectedLocaleName}
        style={{ ...iS, background: selectedLocaleName ? '#F59E0B' : '#1a1f2e', color: selectedLocaleName ? '#0f1420' : '#64748b', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: selectedLocaleName ? 'pointer' : 'not-allowed' }}>
        + Movimento manuale
      </button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
      <KPI label="Articoli in stock" icon="" value={aggregated.length} sub={selectedLocaleName || 'tutti i locali'} accent='#3B82F6' />
      <KPI label="Valore magazzino" icon="" value={fmtD(valoreTot)} sub="a prezzo medio" accent='#10B981' />
      <KPI label="Sotto scorta" icon="" value={sottoScorta} sub="da riordinare" accent={sottoScorta > 0 ? '#EF4444' : '#64748b'} />
    </div>

    <Card title={`Giacenze${selSub !== 'all' ? ' · ' + selSub : ''}`} badge={aggregated.length + ' articoli'}>
      {loading ? (
        <div style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>Caricamento…</div>
      ) : aggregated.length === 0 ? (
        <div style={{ padding: 24, color: '#64748b', textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
          Nessun articolo in magazzino.<br/>
          <span style={{ fontSize: 11 }}>I carichi vengono creati automaticamente quando importi una fattura con <strong>nome_articolo</strong> assegnato a un <strong>locale</strong>. Puoi anche fare un <strong>inventario di apertura</strong> nel tab Inventario.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Articolo', 'UM', 'Quantità', '€/UM medio', 'Valore', selSub === 'all' && selectedLocaleName ? 'Sub' : null, 'Scorta min', 'Stato', ''].filter(Boolean).map(h =>
                <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {aggregated.map(s => {
                const qty = Number(s.quantita || 0)
                const valore = qty * Number(s.prezzo_medio || 0)
                const sotto = s.scorta_minima != null && qty < Number(s.scorta_minima)
                const stato = qty === 0 ? { l: 'Esaurito', c: '#94a3b8', bg: 'rgba(148,163,184,.12)' }
                  : sotto ? { l: 'Sotto scorta', c: '#EF4444', bg: 'rgba(239,68,68,.12)' }
                  : { l: 'OK', c: '#10B981', bg: 'rgba(16,185,129,.12)' }
                return <tr key={s.nome_articolo + (s.sub_location || '')}
                  onClick={() => setSelected(s)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...S.td, fontWeight: 500 }}>{s.nome_articolo}</td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>{s.unita || '—'}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{fmtN(qty)}</td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>{s.prezzo_medio ? fmtD(s.prezzo_medio) : '—'}</td>
                  <td style={{ ...S.td, color: '#F59E0B', fontWeight: 600 }}>{fmtD(valore)}</td>
                  {selSub === 'all' && selectedLocaleName && (
                    <td style={{ ...S.td, fontSize: 10, color: '#94a3b8' }}>
                      {Array.isArray(s.sub_locations) ? s.sub_locations.join(' · ') : (s.sub_location || '')}
                    </td>
                  )}
                  <td style={{ ...S.td, color: '#64748b', fontSize: 11 }}>{s.scorta_minima || '—'}</td>
                  <td style={S.td}><span style={S.badge(stato.c, stato.bg)}>{stato.l}</span></td>
                  <td style={{ ...S.td, color: '#64748b' }}></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>

    {showSubConfig && selectedLocaleName && (
      <SubLocationConfig locale={selectedLocaleName} map={subMap}
        onClose={() => setShowSubConfig(false)} onSaved={(m) => { setSubMap(m); setShowSubConfig(false) }} />
    )}

    {showManualMove && selectedLocaleName && (
      <ManualMovementModal locale={selectedLocaleName}
        subLocations={subsForLocale} onClose={() => setShowManualMove(false)}
        onSaved={() => { setShowManualMove(false); load() }} />
    )}

    {selected && (
      <ArticleDetailModal item={selected} locale={selectedLocaleName}
        onClose={() => setSelected(null)} onChange={load} />
    )}
  </>
}

function SubLocationConfig({ locale, map, onClose, onSaved }) {
  const [subs, setSubs] = useState(() => (map[locale] || []).join(', '))
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const list = subs.split(',').map(s => s.trim()).filter(Boolean)
      const next = await setSubLocations(locale, list)
      onSaved(next)
    } catch (e) { alert(e.message); setSaving(false) }
  }
  return <Modal onClose={onClose} title={'Sub-location · ' + locale} maxWidth={480}>
    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
      Inserisci le sub-location separate da virgola. Es: <code style={{ color: '#F59E0B' }}>Bar, Cucina, Cantina</code>.<br/>
      Se lasci vuoto, il locale avrà un unico magazzino "principale".
    </div>
    <input value={subs} onChange={e => setSubs(e.target.value)}
      placeholder="Bar, Cucina, Cantina"
      style={{ ...iS, width: '100%', marginBottom: 16 }} />
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
      <button onClick={save} disabled={saving}
        style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
        {saving ? 'Salvo…' : 'Salva'}
      </button>
    </div>
  </Modal>
}

function ManualMovementModal({ locale, subLocations, onClose, onSaved }) {
  const [articles, setArticles] = useState([])
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('carico')
  const [qty, setQty] = useState('')
  const [unita, setUnita] = useState('')
  const [prezzo, setPrezzo] = useState('')
  const [sub, setSub] = useState(subLocations[0] || 'principale')
  const [subTarget, setSubTarget] = useState(subLocations[1] || subLocations[0] || 'principale')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: items } = await supabase.from('warehouse_invoice_items')
        .select('nome_articolo, unita').not('nome_articolo', 'is', null).limit(500)
      const names = new Map()
      ;(items || []).forEach(i => { if (i.nome_articolo) names.set(i.nome_articolo, i.unita) })
      setArticles([...names.entries()].map(([n, u]) => ({ nome: n, unita: u })).sort((a, b) => a.nome.localeCompare(b.nome)))
    })()
  }, [])

  const submit = async () => {
    if (!nome || !qty) { alert('Articolo e quantità obbligatori'); return }
    setSaving(true)
    try {
      await applyMovement({
        locale, subLocation: sub, nomeArticolo: nome, tipo, quantita: Number(qty),
        unita: unita || null, prezzoUnitario: prezzo ? Number(prezzo) : null,
        subLocationTarget: tipo === 'trasferimento_out' ? subTarget : null,
        note: note || null, fonte: 'manuale',
      })
      onSaved()
    } catch (e) { alert(e.message); setSaving(false) }
  }

  const suggestedUnita = articles.find(a => a.nome === nome)?.unita
  useEffect(() => { if (suggestedUnita && !unita) setUnita(suggestedUnita) }, [suggestedUnita, unita])

  return <Modal onClose={onClose} title="+ Movimento manuale" maxWidth={520}>
    <Field label="Tipo">
      <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...iS, width: '100%' }}>
        <option value="carico">Carico (+)</option>
        <option value="scarico">Scarico spreco/omaggio (−)</option>
        <option value="trasferimento_out">Trasferimento tra sub-location</option>
        <option value="correzione">Correzione manuale</option>
      </select>
    </Field>
    <Field label="Articolo">
      <input list="art-list" value={nome} onChange={e => setNome(e.target.value)}
        placeholder="Es. Pomodoro pelato" style={{ ...iS, width: '100%' }} />
      <datalist id="art-list">
        {articles.map(a => <option key={a.nome} value={a.nome}>{a.unita}</option>)}
      </datalist>
    </Field>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
      <Field label="Quantità">
        <input type="number" step="0.01" value={qty} onChange={e => setQty(e.target.value)}
          style={{ ...iS, width: '100%' }} />
      </Field>
      <Field label="UM">
        <input value={unita} onChange={e => setUnita(e.target.value)} placeholder="KG"
          style={{ ...iS, width: '100%' }} />
      </Field>
      <Field label="€/UM (opz.)">
        <input type="number" step="0.001" value={prezzo} onChange={e => setPrezzo(e.target.value)}
          style={{ ...iS, width: '100%' }} />
      </Field>
    </div>
    <Field label={tipo === 'trasferimento_out' ? 'Sub-location origine' : 'Sub-location'}>
      <select value={sub} onChange={e => setSub(e.target.value)} style={{ ...iS, width: '100%' }}>
        {subLocations.map(sl => <option key={sl} value={sl}>{sl}</option>)}
      </select>
    </Field>
    {tipo === 'trasferimento_out' && (
      <Field label="Sub-location destinazione">
        <select value={subTarget} onChange={e => setSubTarget(e.target.value)} style={{ ...iS, width: '100%' }}>
          {subLocations.filter(sl => sl !== sub).map(sl => <option key={sl} value={sl}>{sl}</option>)}
        </select>
      </Field>
    )}
    <Field label="Note (opzionale)">
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
        style={{ ...iS, width: '100%', resize: 'vertical' }} />
    </Field>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
      <button onClick={onClose} style={{ ...iS, padding: '8px 16px', cursor: 'pointer' }}>Annulla</button>
      <button onClick={submit} disabled={saving}
        style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '8px 20px', cursor: saving ? 'wait' : 'pointer' }}>
        {saving ? 'Salvo…' : 'Salva movimento'}
      </button>
    </div>
  </Modal>
}

function ArticleDetailModal({ item, locale, onClose, onChange }) {
  const [moves, setMoves] = useState([])
  const [loading, setLoading] = useState(true)
  const [scortaMin, setScortaMin] = useState(item.scorta_minima ?? '')

  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data } = await supabase.from('article_movement')
        .select('*').eq('nome_articolo', item.nome_articolo).eq('locale', item.locale)
        .order('created_at', { ascending: false }).limit(50)
      setMoves(data || [])
      setLoading(false)
    })()
  }, [item])

  const saveScorta = async () => {
    const v = scortaMin === '' ? null : Number(scortaMin)
    await supabase.from('article_stock').update({ scorta_minima: v }).eq('id', item.id)
    onChange()
  }

  return <Modal onClose={onClose} title={item.nome_articolo}
    subtitle={`${locale}${item.sub_location && item.sub_location !== 'principale' ? ' / ' + item.sub_location : ''}`}
    maxWidth={640}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
      <div style={{ background: '#131825', padding: 10, borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: '#64748b' }}>Giacenza</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#F59E0B' }}>{fmtN(item.quantita)} {item.unita || ''}</div>
      </div>
      <div style={{ background: '#131825', padding: 10, borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: '#64748b' }}>Valore</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#10B981' }}>{fmtD(Number(item.quantita) * Number(item.prezzo_medio || 0))}</div>
      </div>
      <div style={{ background: '#131825', padding: 10, borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: '#64748b' }}>€/UM medio</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{item.prezzo_medio ? fmtD(item.prezzo_medio) : '—'}</div>
      </div>
    </div>

    <Field label="Scorta minima (opzionale)">
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="number" step="0.01" value={scortaMin} onChange={e => setScortaMin(e.target.value)}
          placeholder="es. 5" style={{ ...iS, flex: 1 }} />
        <button onClick={saveScorta} style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 600, border: 'none', padding: '6px 14px', cursor: 'pointer' }}>
          Salva
        </button>
      </div>
    </Field>

    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 16, marginBottom: 8 }}>
      Ultimi movimenti
    </div>
    {loading ? (
      <div style={{ padding: 12, color: '#64748b' }}>Caricamento…</div>
    ) : moves.length === 0 ? (
      <div style={{ padding: 12, color: '#64748b', fontSize: 12 }}>Nessun movimento registrato.</div>
    ) : (
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            {moves.map(m => {
              const sign = ['carico', 'trasferimento_in', 'apertura'].includes(m.tipo) ? '+' : '−'
              const col = ['scarico', 'trasferimento_out'].includes(m.tipo) ? '#EF4444' : '#10B981'
              return <tr key={m.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ padding: '6px 4px', color: '#94a3b8' }}>{new Date(m.created_at).toLocaleDateString('it-IT')} {new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td>
                <td style={{ padding: '6px 4px' }}>
                  <span style={S.badge(col, col + '22')}>{m.tipo}</span>
                </td>
                <td style={{ padding: '6px 4px', fontWeight: 600, color: col }}>
                  {sign}{fmtN(m.quantita)} {m.unita || ''}
                </td>
                <td style={{ padding: '6px 4px', fontSize: 10, color: '#64748b' }}>
                  {m.sub_location} {m.sub_location_target ? '' + m.sub_location_target : ''}
                </td>
                <td style={{ padding: '6px 4px', fontSize: 10, color: '#94a3b8', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.riferimento_label || m.note || m.fonte}
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}
  </Modal>
}

function Modal({ title, subtitle, maxWidth = 560, onClose, children }) {
  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth }}>
      <div style={{ padding: 16, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <label style={{ display: 'block', marginBottom: 10 }}>
    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
    {children}
  </label>
}
