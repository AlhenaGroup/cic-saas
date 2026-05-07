import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input

// Mappa magazzino (beverage/food/materiali/...) a etichetta leggibile per il filtro categoria.
const CAT_LABELS = { food: 'Food', beverage: 'Beverage', materiali: 'Materiali', attrezzatura: 'Attrezzatura', altro: 'Altro' }

export default function PriceAnalysis() {
  // Articoli aggregati dalle righe fattura (esclude escludi_magazzino)
  const [articles, setArticles] = useState([])
  const [selectedArt, setSelectedArt] = useState(null)
  const [selectedSource, setSelectedSource] = useState(null) // 'alert' | 'table'
  const [filter, setFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [fornFilter, setFornFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    // Leggo tutte le righe + info fattura in un'unica query via foreign key embed.
    const { data: items } = await supabase.from('warehouse_invoice_items')
      .select('nome_articolo, nome_fattura, unita, quantita, qty_singola, totale_um, prezzo_totale, magazzino, escludi_magazzino, warehouse_invoices!inner(data, fornitore, locale)')
      .order('id')
    // Aggrego per nome articolo (case-insensitive), tenendo lo storico di tutti i prezzi per UM
    const map = {}
    ;(items || []).forEach(it => {
      if (it.escludi_magazzino) return             // articoli esclusi dal magazzino NON entrano nell'analisi
      if (!it.nome_articolo) return                // solo righe associate a un articolo interno
      const qtyFatt = Number(it.quantita) || 0
      const qtyTipo = Number(it.totale_um) || 0
      const qSing   = Number(it.qty_singola) || 0
      const totUnita = qtyFatt * qtyTipo * qSing
      const spesa = Math.abs(Number(it.prezzo_totale) || 0)
      if (totUnita <= 0 || spesa <= 0) return
      const prezzoUM = spesa / totUnita
      const key = it.nome_articolo.toLowerCase().trim()
      if (!map[key]) map[key] = {
        nome: it.nome_articolo,
        unita: it.unita || '',
        magazzino: it.magazzino || '',
        fornitoriCount: {},
        storico: [], // { data, prezzo, fornitore, locale }
      }
      const a = map[key]
      if (it.magazzino && !a.magazzino) a.magazzino = it.magazzino
      if (it.unita && !a.unita) a.unita = it.unita
      const forn = it.warehouse_invoices?.fornitore || '-'
      a.fornitoriCount[forn] = (a.fornitoriCount[forn] || 0) + 1
      a.storico.push({
        data: it.warehouse_invoices?.data || '',
        prezzo: Math.round(prezzoUM * 10000) / 10000,
        fornitore: forn,
        locale: it.warehouse_invoices?.locale || '',
      })
    })
    // Finalizza calcoli
    const list = Object.values(map).map(a => {
      const storicoSorted = [...a.storico].sort((x, y) => (y.data || '').localeCompare(x.data || ''))
      const ultimo = storicoSorted[0]?.prezzo || 0
      const medio = a.storico.length > 0
        ? a.storico.reduce((s, p) => s + p.prezzo, 0) / a.storico.length : 0
      let variazione = 0
      if (storicoSorted.length >= 2 && storicoSorted[1].prezzo > 0) {
        variazione = (storicoSorted[0].prezzo - storicoSorted[1].prezzo) / storicoSorted[1].prezzo * 100
      }
      const fornitorePrincipale = Object.entries(a.fornitoriCount)
        .sort((x, y) => y[1] - x[1])[0]?.[0] || '-'
      return {
        nome: a.nome,
        unita: a.unita,
        magazzino: a.magazzino,
        categoria: CAT_LABELS[a.magazzino] || a.magazzino || '—',
        fornitore_principale: fornitorePrincipale,
        ultimo_prezzo: Math.round(ultimo * 10000) / 10000,
        prezzo_medio: Math.round(medio * 10000) / 10000,
        variazione,
        historyCount: a.storico.length,
        storico: storicoSorted,
      }
    })
    setArticles(list)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => articles.filter(a => {
    if (filter && !a.nome.toLowerCase().includes(filter.toLowerCase())) return false
    if (catFilter && a.categoria !== catFilter) return false
    if (fornFilter && a.fornitore_principale !== fornFilter) return false
    return true
  }).sort((a, b) => a.nome.localeCompare(b.nome)), [articles, filter, catFilter, fornFilter])

  const alerts = useMemo(() => articles.filter(a => a.variazione > 10).sort((a, b) => b.variazione - a.variazione), [articles])

  const categories = useMemo(() => [...new Set(articles.map(a => a.categoria).filter(Boolean))], [articles])
  const fornitori = useMemo(() => [...new Set(articles.map(a => a.fornitore_principale).filter(f => f && f !== '-'))], [articles])

  const selected = selectedArt ? articles.find(a => a.nome === selectedArt) : null

  const closeDetail = () => { setSelectedArt(null); setSelectedSource(null) }
  const selectFrom = (nome, source) => {
    if (selectedArt === nome) { closeDetail(); return }
    setSelectedArt(nome); setSelectedSource(source)
  }

  // Pannello dettaglio storico — riusato sia inline (sotto Allerta) che in fondo (sotto tabella)
  const renderDetail = () => selected && (
    <Card title={'Storico prezzi: ' + selected.nome} badge={selected.storico.length + ' registrazioni'}
      extra={<button onClick={closeDetail} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text2)', padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}>Chiudi</button>}>
      {selected.storico.length === 0
        ? <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 20 }}>Nessuno storico prezzi</div>
        : <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, marginBottom: 16, padding: '0 8px' }}>
            {(() => {
              const maxP = Math.max(...selected.storico.map(p => p.prezzo || 0), 0.01)
              return selected.storico.slice().reverse().map((p, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: 'var(--text2)' }}>{fmt(p.prezzo)}</span>
                  <div style={{ width: '100%', maxWidth: 30, height: Math.max((p.prezzo / maxP) * 100, 4), background: '#F59E0B', borderRadius: 3 }} />
                  <span style={{ fontSize: 8, color: 'var(--text3)' }}>{(p.data || '').slice(5)}</span>
                </div>
              ))
            })()}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Data', 'Fornitore', 'Locale', 'Prezzo/UM'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {selected.storico.map((p, i) => (
                <tr key={i}>
                  <td style={S.td}>{p.data}</td>
                  <td style={{ ...S.td, color: 'var(--text2)' }}>{p.fornitore}</td>
                  <td style={{ ...S.td, color: 'var(--text2)' }}>{p.locale}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{fmt(p.prezzo)}/{selected.unita}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      }
    </Card>
  )

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)', fontSize: 13 }}>Caricamento prezzi...</div>

  return <>
    {alerts.length > 0 && <Card title="Allerta prezzi" badge={alerts.length + ' aumenti significativi'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {alerts.slice(0, 8).map(a => {
          const isSel = selectedArt === a.nome && selectedSource === 'alert'
          return <div key={a.nome}
            style={{ ...S.card, padding: '10px 14px', minWidth: 180, flex: '0 0 auto', cursor: 'pointer',
              border: isSel ? '1px solid #F59E0B' : S.card.border,
              background: isSel ? 'rgba(245,158,11,.08)' : S.card.background }}
            onClick={() => selectFrom(a.nome, 'alert')}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{a.nome}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>{a.fornitore_principale}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#EF4444', marginTop: 4 }}>+{a.variazione.toFixed(1)}%</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmt(a.ultimo_prezzo)}/{a.unita}</div>
          </div>
        })}
      </div>
      {/* Pannello dettaglio inline quando aperto da Allerta */}
      {selected && selectedSource === 'alert' && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {renderDetail()}
        </div>
      )}
    </Card>}

    {alerts.length > 0 && <div style={{ marginTop: 12 }} />}

    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <input placeholder="Cerca articolo..." value={filter} onChange={e => setFilter(e.target.value)} style={{ ...iS, flex: 1, minWidth: 180 }} />
      <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={iS}>
        <option value="">Tutte le categorie</option>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={fornFilter} onChange={e => setFornFilter(e.target.value)} style={iS}>
        <option value="">Tutti i fornitori</option>
        {fornitori.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>

    <Card title="Analisi prezzi" badge={filtered.length + ' articoli'}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
          {['Articolo', 'Categoria', 'Fornitore principale', 'Ultimo €/UM', 'Prezzo medio', 'Var. %', 'Storico', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: 'var(--text3)', textAlign: 'center', padding: 20 }}>Nessun articolo trovato</td></tr>}
          {filtered.map(a => {
            const varColor = a.variazione > 5 ? '#EF4444' : a.variazione < -5 ? '#10B981' : '#64748b'
            const isSel = selectedArt === a.nome && selectedSource === 'table'
            return <Fragment key={a.nome}>
              <tr onClick={() => selectFrom(a.nome, 'table')}
                style={{ background: isSel ? '#131825' : 'transparent', cursor: 'pointer', borderBottom: isSel ? 'none' : '1px solid #1a1f2e' }}
                title="Clicca per vedere lo storico prezzi">
                <td style={{ ...S.td, fontWeight: 500 }}>{a.nome}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12 }}>{a.categoria}</td>
                <td style={{ ...S.td, color: 'var(--text2)', fontSize: 12 }}>{a.fornitore_principale}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{a.ultimo_prezzo ? fmt(a.ultimo_prezzo) + '/' + a.unita : '-'}</td>
                <td style={{ ...S.td, color: 'var(--text3)' }}>{a.prezzo_medio ? fmt(a.prezzo_medio) + '/' + a.unita : '-'}</td>
                <td style={S.td}>
                  {a.historyCount >= 2
                    ? <span style={S.badge(varColor, a.variazione > 5 ? 'rgba(239,68,68,.12)' : a.variazione < -5 ? 'rgba(16,185,129,.12)' : 'rgba(148,163,184,.1)')}>
                        {a.variazione > 0 ? '+' : ''}{a.variazione.toFixed(1)}%
                      </span>
                    : <span style={{ color: 'var(--text3)', fontSize: 12 }}>-</span>
                  }
                </td>
                <td style={{ ...S.td, color: 'var(--text3)', fontSize: 12 }}>{a.historyCount} registrazioni</td>
                <td style={{ ...S.td, color: '#3B82F6', fontSize: 11, fontWeight: 600 }}>
                  {isSel ? 'Chiudi ' : 'Dettaglio '}
                </td>
              </tr>
              {isSel && (
                <tr style={{ background: 'var(--bg)' }}>
                  <td colSpan={8} style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
                    {renderDetail()}
                  </td>
                </tr>
              )}
            </Fragment>
          })}
        </tbody>
      </table>
    </Card>

  </>
}
