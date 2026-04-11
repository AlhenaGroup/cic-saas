import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { S, KPI, Card, Bar2, fmt, fmtD, fmtN, pct } from './shared/styles.jsx'

// Regole di categorizzazione automatica per fornitore/prodotto
export const CATEGORY_RULES = {
  food: {
    label: '🍕 Food cost',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,.12)',
    fornitori: /metro|partesa|davide|ortofrutta|food|carne|pesce|frutta|verdur|macell|salum|panific|latt|uova|farin|riso|pasta|olio|formagg/i,
    prodotti: /carne|pesce|frutta|verdur|insalata|pomodor|mozzarell|formagg|prosciutt|salame|farina|riso|pasta|olio|burro|uova|pane|latte|patate|cipoll|aglio|fungh|legu|salsa/i,
  },
  beverage: {
    label: '🍺 Beverage cost',
    color: '#3B82F6',
    bg: 'rgba(59,130,246,.12)',
    fornitori: /beverage|nobile|birr|vin|spirit|drink|coca|bevand|campari|aperol|martini|peroni|heineken|moretti/i,
    prodotti: /birra|vino|spirit|cocktail|coca.?cola|fanta|sprite|acqua.*min|succo|prosecco|spumante|amaro|grappa|whisky|vodka|gin|rum|tonic|aperol|campari|spritz/i,
  },
  materiali: {
    label: '📦 Mat. consumo',
    color: '#8B5CF6',
    bg: 'rgba(139,92,246,.12)',
    fornitori: /consumo|materiale|packagin|carta|plastica|detersiv|clean|igien|monous/i,
    prodotti: /tovaglio|piatt|bicchier|posate|busta|sacchett|pellicol|alluminio|detersiv|sapone|carta|guant|mascherina|contenitor|vaschett/i,
  },
  struttura: {
    label: '🏗️ Struttura',
    color: '#EC4899',
    bg: 'rgba(236,72,153,.12)',
    fornitori: /hera|enel|gas|acqua|affitto|manutenzione|assicuraz|telecom|tim|vodafone|fastweb|rent|locazione|condomin|riparazion/i,
    prodotti: /energia|gas|acqua|affitto|canone|manutenzione|riparazione|assicurazione|telefon|internet|pulizia|smaltimento|rifiut/i,
  },
  personale: {
    label: '👥 Personale',
    color: '#10B981',
    bg: 'rgba(16,185,129,.12)',
    fornitori: /personale|consulen|paga|lavoro|inps|inail|studio.*commerc|paghe|stipend/i,
    prodotti: /stipendio|contribut|inps|inail|tfr|consulenza.*lavoro|busta.*paga/i,
  },
}

export function categorizeItem(fornitore, descrizione) {
  const forn = (fornitore || '').toLowerCase()
  const desc = (descrizione || '').toLowerCase()

  for (const [key, rule] of Object.entries(CATEGORY_RULES)) {
    if (rule.fornitori.test(forn) || rule.prodotti.test(desc)) {
      return { category: key, confidence: rule.fornitori.test(forn) && rule.prodotti.test(desc) ? 'alta' : rule.fornitori.test(forn) ? 'media' : 'bassa' }
    }
  }
  return { category: 'altro', confidence: 'nessuna' }
}

export default function ContoEconomico({ ce, from, to }) {
  const [invoices, setInvoices] = useState([])
  const [invoiceItems, setInvoiceItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState('tutte') // tutte, food, beverage, materiali, struttura, personale, altro
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cic_ce_category_overrides') || '{}') } catch { return {} }
  })

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    const { data: invs } = await supabase.from('warehouse_invoices').select('*').order('data', { ascending: false })
    const { data: items } = await supabase.from('warehouse_invoice_items').select('*, warehouse_invoices!inner(fornitore, data, locale, numero)')
    setInvoices(invs || [])
    setInvoiceItems(items || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // F&B = food + beverage (solo indicatore, NON costo nel MOL)
  const fb = (ce.foodCost || 0) + (ce.bevCost || 0)
  const fbPct = ce.ricavi > 0 ? (fb / ce.ricavi * 100) : 0

  // Categorizza ogni riga fattura
  const categorizedItems = invoiceItems.map(item => {
    const itemKey = item.id
    if (overrides[itemKey]) {
      return { ...item, _cat: overrides[itemKey], _confidence: 'manuale' }
    }
    const { category, confidence } = categorizeItem(
      item.warehouse_invoices?.fornitore || '',
      item.nome_fattura || ''
    )
    return { ...item, _cat: category, _confidence: confidence }
  })

  // Anche fatture intere (senza righe dettaglio)
  const categorizedInvoices = invoices.map(inv => {
    const hasItems = categorizedItems.some(it => it.invoice_id === inv.id)
    if (hasItems) return { ...inv, _hasItems: true }
    const { category, confidence } = categorizeItem(inv.fornitore, '')
    return { ...inv, _cat: category, _confidence: confidence, _hasItems: false }
  })

  // Conteggi per categoria
  const catCounts = { food: 0, beverage: 0, materiali: 0, struttura: 0, personale: 0, altro: 0 }
  categorizedItems.forEach(it => { catCounts[it._cat] = (catCounts[it._cat] || 0) + 1 })
  // Aggiungi fatture senza righe
  categorizedInvoices.filter(i => !i._hasItems).forEach(inv => { catCounts[inv._cat] = (catCounts[inv._cat] || 0) + 1 })
  const totalItems = Object.values(catCounts).reduce((s, v) => s + v, 0)

  // Fatture raggruppate per voce CE (per la tabella CE)
  const invoicesByVoce = {}
  Object.keys(CATEGORY_RULES).forEach(k => { invoicesByVoce[k] = [] })
  invoicesByVoce.altro = []
  invoices.forEach(inv => {
    const cat = categorizedInvoices.find(ci => ci.id === inv.id)?._cat || 'altro'
    if (!invoicesByVoce[cat]) invoicesByVoce[cat] = []
    invoicesByVoce[cat].push(inv)
  })

  // Filtra items per tab attiva
  const filteredItems = activeFilter === 'tutte'
    ? categorizedItems
    : categorizedItems.filter(it => it._cat === activeFilter)

  const filteredInvoicesNoItems = activeFilter === 'tutte'
    ? categorizedInvoices.filter(i => !i._hasItems)
    : categorizedInvoices.filter(i => !i._hasItems && i._cat === activeFilter)

  // Override categoria
  const setCategory = (itemId, newCat) => {
    const newOverrides = { ...overrides, [itemId]: newCat }
    setOverrides(newOverrides)
    localStorage.setItem('cic_ce_category_overrides', JSON.stringify(newOverrides))
  }

  const confidenceBadge = (conf) => {
    const colors = {
      alta: { c: '#10B981', bg: 'rgba(16,185,129,.12)', label: 'Auto ✓' },
      media: { c: '#F59E0B', bg: 'rgba(245,158,11,.12)', label: 'Auto ~' },
      bassa: { c: '#EF4444', bg: 'rgba(239,68,68,.12)', label: 'Auto ?' },
      manuale: { c: '#3B82F6', bg: 'rgba(59,130,246,.12)', label: 'Manuale' },
      nessuna: { c: '#64748b', bg: 'rgba(100,116,139,.12)', label: 'Non class.' },
    }
    const s = colors[conf] || colors.nessuna
    return <span style={S.badge(s.c, s.bg)}>{s.label}</span>
  }

  const iS = S.input

  const voceLabels = {
    'food': '🍕 Food cost',
    'beverage': '🍺 Beverage cost',
    'materiali': '📦 Mat. consumo',
    'struttura': '🏗️ Struttura',
    'personale': '👥 Personale',
    'altro': '📄 Non categorizzate',
  }

  return <>
    {/* KPI con F&B */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: '1.25rem' }}>
      <KPI label="Ricavi" icon="💶" value={fmt(ce.ricavi)} sub="totale venduto" accent='#10B981' />
      <KPI label="F&B" icon="🍽️" value={fmt(fb)} sub={fbPct.toFixed(1) + '% su incasso'} accent='#F97316' />
      <KPI label="Food cost" icon="🍕" value={fmt(ce.foodCost)} sub={pct(ce.foodCost, ce.ricavi) + ' dei ricavi'} accent='#F59E0B' />
      <KPI label="Bev. cost" icon="🍺" value={fmt(ce.bevCost)} sub={pct(ce.bevCost, ce.ricavi) + ' dei ricavi'} accent='#3B82F6' />
      <KPI label="MOL" icon="📊" value={fmt(ce.mol)} sub={pct(ce.mol, ce.ricavi) + ' margine'} accent='#10B981' />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Conto Economico */}
      <Card title="Conto Economico">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Voce', 'Importo', '% Ricavi', 'Fatture'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {[
              { label: '📈 RICAVI', val: ce.ricavi, bold: true, color: '#10B981', voce: null },
              { label: '🍕 Food cost', val: -ce.foodCost, color: '#EF4444', voce: 'food' },
              { label: '🍺 Beverage cost', val: -ce.bevCost, color: '#EF4444', voce: 'beverage' },
              { label: '📦 Mat. consumo', val: -ce.matCost, color: '#EF4444', voce: 'materiali' },
              { label: '👥 Personale', val: -(ce.persCost || 0), color: '#EF4444', voce: 'personale' },
              { label: '🏗️ Struttura', val: -ce.strCost, color: '#EF4444', voce: 'struttura' },
              { label: '── TOTALE COSTI', val: -ce.totCosti, bold: true, color: '#EF4444', voce: null },
              { label: '📊 MOL', val: ce.mol, bold: true, color: '#10B981', voce: null },
            ].map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: r.bold ? '#131825' : 'transparent', cursor: r.voce ? 'pointer' : 'default' }}
                onClick={() => r.voce && setActiveFilter(activeFilter === r.voce ? 'tutte' : r.voce)}>
                <td style={{ ...S.td, fontWeight: r.bold ? 700 : 400, color: activeFilter === r.voce ? '#F59E0B' : undefined }}>{r.label}</td>
                <td style={{ ...S.td, fontWeight: r.bold ? 700 : 500, color: r.color || '#e2e8f0' }}>{fmt(Math.abs(r.val))}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{pct(Math.abs(r.val), ce.ricavi)}</td>
                <td style={{ ...S.td, color: '#475569', fontSize: 11 }}>
                  {r.voce && <span style={S.badge(activeFilter === r.voce ? '#F59E0B' : '#475569', activeFilter === r.voce ? 'rgba(245,158,11,.12)' : 'rgba(71,85,105,.12)')}>
                    {catCounts[r.voce] || 0} prodotti
                  </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 11, color: '#475569' }}>
          Clicca su una voce per filtrare i prodotti sotto
        </div>
      </Card>

      {/* Composizione costi */}
      <Card title="Composizione costi">
        <div style={{ marginBottom: 16 }}>
          {[
            { label: 'Food cost', val: ce.foodCost, color: '#F59E0B' },
            { label: 'Beverage cost', val: ce.bevCost, color: '#3B82F6' },
            { label: 'Mat. consumo', val: ce.matCost, color: '#8B5CF6' },
            { label: 'Struttura', val: ce.strCost, color: '#EC4899' },
            { label: 'Personale', val: ce.persCost || 0, color: '#10B981' },
          ].map((r, i) => <Bar2 key={i} label={r.label} value={r.val} max={ce.totCosti || 1} color={r.color} pct={ce.totCosti > 0 ? (r.val / ce.totCosti * 100).toFixed(1) : 0} />)}
        </div>
        {/* F&B indicator separato */}
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>F&B (Food + Beverage)</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>Solo indicatore, non incluso nei costi</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F97316' }}>{fbPct.toFixed(1)}%</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{fmt(fb)}</div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid #2a3042', paddingTop: 12, marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: '#94a3b8' }}>MOL %</span>
          <span style={{ color: '#10B981', fontWeight: 700, fontSize: 16 }}>{ce.molPct?.toFixed(1)}%</span>
        </div>
      </Card>
    </div>

    {/* PANNELLO FATTURE/PRODOTTI — SEMPRE VISIBILE */}
    <div style={{ marginTop: 12 }}>
      <Card title="Classificazione prodotti fatture" badge={totalItems > 0 ? totalItems + ' prodotti' : 'In attesa di fatture'} extra={
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => setActiveFilter('tutte')} style={{ ...iS, padding: '4px 10px', fontSize: 11, fontWeight: activeFilter === 'tutte' ? 700 : 400, color: activeFilter === 'tutte' ? '#F59E0B' : '#94a3b8', background: activeFilter === 'tutte' ? 'rgba(245,158,11,.1)' : 'transparent', border: activeFilter === 'tutte' ? '1px solid #F59E0B' : '1px solid #2a3042' }}>
            Tutte ({totalItems})
          </button>
          {Object.entries(CATEGORY_RULES).map(([key, rule]) => (
            <button key={key} onClick={() => setActiveFilter(activeFilter === key ? 'tutte' : key)} style={{ ...iS, padding: '4px 10px', fontSize: 11, fontWeight: activeFilter === key ? 700 : 400, color: activeFilter === key ? rule.color : '#94a3b8', background: activeFilter === key ? rule.bg : 'transparent', border: activeFilter === key ? `1px solid ${rule.color}` : '1px solid #2a3042' }}>
              {rule.label.split(' ').slice(1).join(' ')} ({catCounts[key] || 0})
            </button>
          ))}
          <button onClick={() => setActiveFilter(activeFilter === 'altro' ? 'tutte' : 'altro')} style={{ ...iS, padding: '4px 10px', fontSize: 11, fontWeight: activeFilter === 'altro' ? 700 : 400, color: activeFilter === 'altro' ? '#EF4444' : '#94a3b8', background: activeFilter === 'altro' ? 'rgba(239,68,68,.1)' : 'transparent', border: activeFilter === 'altro' ? '1px solid #EF4444' : '1px solid #2a3042' }}>
            Non class. ({catCounts.altro || 0})
          </button>
        </div>
      }>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#F59E0B', fontSize: 12 }}>Caricamento fatture...</div>
        ) : totalItems === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>Nessuna fattura nel sistema</div>
            <div style={{ fontSize: 12, color: '#475569', maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
              Quando importerai le fatture passive (da CiC o manualmente nel modulo Magazzino → Fatture),
              i prodotti verranno automaticamente classificati in <span style={{ color: '#F59E0B' }}>Food</span>,{' '}
              <span style={{ color: '#3B82F6' }}>Beverage</span>, <span style={{ color: '#8B5CF6' }}>Materiali</span>,{' '}
              <span style={{ color: '#EC4899' }}>Struttura</span> e <span style={{ color: '#10B981' }}>Personale</span> in base al fornitore e alla descrizione del prodotto.
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              {Object.entries(CATEGORY_RULES).map(([key, rule]) => (
                <div key={key} style={{ ...S.card, padding: '10px 16px', minWidth: 130, textAlign: 'center', border: `1px solid ${rule.color}33` }}>
                  <div style={{ fontSize: 11, color: rule.color, fontWeight: 600, marginBottom: 4 }}>{rule.label}</div>
                  <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.5 }}>
                    {key === 'food' && 'Carne, pesce, frutta, verdura, latticini...'}
                    {key === 'beverage' && 'Birra, vino, spirits, bibite, succhi...'}
                    {key === 'materiali' && 'Tovaglioli, piatti, bicchieri, detersivi...'}
                    {key === 'struttura' && 'Energia, gas, acqua, affitto, manutenzione...'}
                    {key === 'personale' && 'Stipendi, contributi, consulenze...'}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 12, background: '#131825', borderRadius: 8, border: '1px solid #2a3042' }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Come funziona il riconoscimento automatico:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={S.badge('#10B981', 'rgba(16,185,129,.12)')}>Auto ✓</span>
                  <span style={{ color: '#94a3b8' }}>Fornitore + prodotto riconosciuti</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={S.badge('#F59E0B', 'rgba(245,158,11,.12)')}>Auto ~</span>
                  <span style={{ color: '#94a3b8' }}>Solo fornitore riconosciuto</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={S.badge('#EF4444', 'rgba(239,68,68,.12)')}>Auto ?</span>
                  <span style={{ color: '#94a3b8' }}>Solo prodotto riconosciuto</span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
                Puoi sempre correggere la classificazione manualmente con il menu a tendina sulla riga del prodotto.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Riepilogo per categoria */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 16 }}>
              {Object.entries(CATEGORY_RULES).map(([key, rule]) => (
                <div key={key} onClick={() => setActiveFilter(activeFilter === key ? 'tutte' : key)}
                  style={{ padding: '8px 12px', background: activeFilter === key ? rule.bg : '#131825', borderRadius: 8, border: `1px solid ${activeFilter === key ? rule.color : '#2a3042'}`, cursor: 'pointer', textAlign: 'center', transition: 'all .2s' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: rule.color }}>{catCounts[key] || 0}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{rule.label.split(' ').slice(1).join(' ')}</div>
                </div>
              ))}
              <div onClick={() => setActiveFilter(activeFilter === 'altro' ? 'tutte' : 'altro')}
                style={{ padding: '8px 12px', background: activeFilter === 'altro' ? 'rgba(239,68,68,.1)' : '#131825', borderRadius: 8, border: `1px solid ${activeFilter === 'altro' ? '#EF4444' : '#2a3042'}`, cursor: 'pointer', textAlign: 'center', transition: 'all .2s' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#EF4444' }}>{catCounts.altro || 0}</div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Non class.</div>
              </div>
            </div>

            {/* Tabella prodotti */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
                {['Fornitore', 'Prodotto', 'Qtà', 'Prezzo', 'Categoria', 'Riconoscimento', 'Correggi'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filteredItems.length === 0 && filteredInvoicesNoItems.length === 0 && (
                  <tr><td colSpan={7} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>
                    Nessun prodotto in questa categoria
                  </td></tr>
                )}
                {filteredItems.map((item, i) => (
                  <tr key={item.id || i} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{item.warehouse_invoices?.fornitore || '—'}</td>
                    <td style={{ ...S.td, fontWeight: 500 }}>{item.nome_fattura || '—'}</td>
                    <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{item.quantita ? fmtN(item.quantita) + ' ' + (item.unita || '') : '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{item.prezzo_totale ? fmtD(item.prezzo_totale) : item.prezzo_unitario ? fmtD(item.prezzo_unitario) : '—'}</td>
                    <td style={S.td}>
                      <span style={S.badge(
                        (CATEGORY_RULES[item._cat]?.color || '#64748b'),
                        (CATEGORY_RULES[item._cat]?.bg || 'rgba(100,116,139,.12)')
                      )}>
                        {voceLabels[item._cat] || '📄 Altro'}
                      </span>
                    </td>
                    <td style={S.td}>{confidenceBadge(item._confidence)}</td>
                    <td style={S.td}>
                      <select value={item._cat} onChange={e => setCategory(item.id, e.target.value)}
                        style={{ ...iS, fontSize: 10, padding: '2px 6px', width: 100 }}>
                        {Object.entries(voceLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {/* Fatture senza righe dettaglio */}
                {filteredInvoicesNoItems.map((inv, i) => (
                  <tr key={'inv-' + (inv.id || i)} style={{ borderBottom: '1px solid #1a1f2e', background: '#131825' }}>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{inv.fornitore}</td>
                    <td style={{ ...S.td, fontWeight: 500, color: '#64748b', fontStyle: 'italic' }}>Fattura n° {inv.numero || '—'} del {inv.data}</td>
                    <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>—</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{inv.totale ? fmtD(inv.totale) : '—'}</td>
                    <td style={S.td}>
                      <span style={S.badge(
                        (CATEGORY_RULES[inv._cat]?.color || '#64748b'),
                        (CATEGORY_RULES[inv._cat]?.bg || 'rgba(100,116,139,.12)')
                      )}>
                        {voceLabels[inv._cat] || '📄 Altro'}
                      </span>
                    </td>
                    <td style={S.td}>{confidenceBadge(inv._confidence)}</td>
                    <td style={S.td}>
                      <select value={inv._cat} onChange={e => {
                        // Per fatture senza righe, salviamo con prefix 'inv-'
                        const newOverrides = { ...overrides, ['inv-' + inv.id]: e.target.value }
                        setOverrides(newOverrides)
                        localStorage.setItem('cic_ce_category_overrides', JSON.stringify(newOverrides))
                      }} style={{ ...iS, fontSize: 10, padding: '2px 6px', width: 100 }}>
                        {Object.entries(voceLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  </>
}
