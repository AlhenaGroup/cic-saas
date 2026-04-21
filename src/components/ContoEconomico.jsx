import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { S, KPI, Card, Bar2, fmt, fmtD, fmtN, pct } from './shared/styles.jsx'
import ManualCostsManager from './ManualCostsManager.jsx'
import { expandManualCost, VOCE_LABELS } from '../lib/manualCosts.js'

// Regole di categorizzazione automatica per fornitore/prodotto
export const CATEGORY_RULES = {
  beverage: {
    label: '🍺 Beverage cost',
    color: '#3B82F6',
    bg: 'rgba(59,130,246,.12)',
    prodotti: /birr|vin[oa]|spirit|cocktail|coca.?col|fanta|sprite|acqua.*min|succ[ohi]|prosecc|spumant|amar[oie]|grapp|whisk|vodka|gin\b|rum\b|tonic|aperol|campari|spritz|beverage|drink|beer|wine|liquor|bottigli|lattin|fusto|keg|chinotto|gassosa|cedrata|limonat|aranciata|energy|redbull|red bull|monster|schweppes|sanbitter|crodino|vermouth|negroni|mojito|daiquiri|sangria|champagn|lambrusco|chianti|barolo|barbera|moscato|nebbiolo|merlot|cabernet|chardonnay|sauvignon|pinot|syrah|primitivo|nero.*avola|montepulciano|trebbiano|malvasia|verdicchio|ribolla|sciropp|the\b|te\b|tea\b|tisana|infuso|camomilla|caffe|espresso|cappuccin|orzata|cedro|menta|sambuc|limoncell|genepy|mirto|fernet|jager|bailey|kahlua|cointreau|maraschino|angostura|bitter|soda|seltz|tequila|mezcal|sake|pisco|absinth|vernacc/i,
  },
  materiali: {
    label: '📦 Mat. consumo',
    color: '#8B5CF6',
    bg: 'rgba(139,92,246,.12)',
    prodotti: /tovagli|piatt|bicchier|posat[eai]|bust[ae]|sacchett|pellic|allumini|detersiv|sapon|carta|guant|mascherin|contenitor|vaschett|monous|rotol|dispenser|igienizz|bobina|film|cling|doypak|stagnola|candegg|sgrassat|detergent|spugn|scope|paletta|secchi|mocio|sacco|nettezza|imballag|scotch|nastro.*ades/i,
  },
  struttura: {
    label: '🏗️ Struttura',
    color: '#EC4899',
    bg: 'rgba(236,72,153,.12)',
    prodotti: /energi|gas\b|elettri|acqua\b|affitt|canon[ei]|manutenz|riparaz|assicuraz|telefon|internet|pulizi|smaltiment|rifiut|noleggi|utenz|rata\b|leasing|consulenz|commercialist|notai|avvocat|boll[oi]|tribut|fiber|fibra|adsl|sim\b|telefonia|luce\b|metano|gpl|gasolio|diesel|cauzion|spes[ea]|commission|bancari|bonico|postaliz|francobol|corriere|spedizion|trasport|facchinag|multa|sanzione|penale|tassa|imposit|diritti|marca.*bollo|vidimaz/i,
  },
  personale: {
    label: '👥 Personale',
    color: '#10B981',
    bg: 'rgba(16,185,129,.12)',
    prodotti: /stipendi|contribut|inps|inail|tfr|consulenza.*lavoro|busta.*paga|cedolin|retribuz/i,
  },
  food: {
    label: '🍕 Food cost',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,.12)',
    // Match parziale: "mortad" matcha mortadella, "olive" matcha olive, "provol" matcha provola
    prodotti: /carn[ei]|pesc[ei]|frutt|verdur|insal|pomodo|mozzar|formag|prosciut|mortad|salam[ei]|farin|riso\b|pasta\b|oli[ov]|burro|uov[ao]|pane\b|latt[ei]|patat|cipol|aglio|fungh|legum|sals[ae]|sugo|pizza|impast|condim|spezi|zuccher|sale\b|acet|maiones|ketchup|poll[oia]|manz|maial|salmon|tonn[oi]|gamber|basili|origan|pepe\b|limon|aranci|pangrat|lievit|semol|grana\b|parmig|pecori|ricott|mascarpon|panna|bescia|wurst|bacon|pancett|guancial|lonz[ao]|coppa\b|bresaol|speck|arrosto|scamor|provol|stracchi|gorgonzol|taleggi|asiago|fontina|emmental|brie|caciott|burgat|roquefort|crescenz|squacquer|raviol|gnocch|tortell|cappellett|lasagn|cannelon|piadina|focacc|grissini|cracker|crostini|bruschett|tarall|oliv[eao]|capperi|carciof|melanzane|zucchin|peperoni|brocco|cavolfi|spinac|bieto|rucol|lattug|radicchi|finocchi|sedano|carota|rapa|barbabiet|asparag|pisell|fagiol|cec[ie]|lenticchi|soia|tofu|seitan|noc[ie]|mandorl|pistacch|arachid|nocci|pinoli|uvetta|datteri|fichi|prugne|albicocc|cilieg|fragol|lampon|mirtin|gelat|sorbett|tirami|pannacoita|crostata|crema|cioccol|vanig|cannella|noce.*moscata|anice|zafferan|curcum|paprik|peperonc|tabasco|senap|worces|soia\b|tamari|wasabi|miso|dashi|nori|kombu|sesamo|semi.*girasol|semi.*zucca|semi.*lin|surgelat|congelat|sottovuot|affettat|macinat|filetto|costata|braciola|costol|lombat|scamone|fesa\b|noce\b|girello|ossobuc|stinco|agnello|capretto|coniglio|vitello|anatra|tacchino|quagli|fagiano|cervo|cinghiale|sgombr|acciug|alice|sardina|merluzzo|nasello|orata|branzino|spigol|trota|pesce.*spada|polpo|calamari|seppi|cozze|vongol|cannocc|scampi|aragost|astice|ricci.*mare/i,
  },
}

// ─── Mappature apprese: nome_prodotto → categoria (Supabase) ────────
// Quando l'utente corregge una categoria, il nome viene salvato su DB.
// La prossima volta che lo stesso nome appare (anche per un altro utente
// dello stesso account), viene classificato automaticamente.

// Cache in-memory per evitare query ripetute durante il render
let _learnedCache = null

export function setLearnedCache(map) { _learnedCache = map }
export function getLearnedCategories() { return _learnedCache || {} }

export function categorizeItem(fornitore, descrizione) {
  const desc = (descrizione || '').toLowerCase().trim()

  // PRIORITA 1: mappatura appresa dal DB (l'utente ha corretto questo nome)
  if (desc) {
    const learned = getLearnedCategories()
    if (learned[desc]) {
      return { category: learned[desc], confidence: 'appresa' }
    }
  }

  // PRIORITA 2: classifica per nome prodotto/descrizione con regex
  if (desc) {
    for (const [key, rule] of Object.entries(CATEGORY_RULES)) {
      if (rule.prodotti.test(desc)) {
        return { category: key, confidence: 'media' }
      }
    }
  }

  // Nessun match: "altro"
  return { category: 'altro', confidence: 'nessuna' }
}

export default function ContoEconomico({ ce, from, to, reload }) {
  const [invoices, setInvoices] = useState([])
  const [invoiceItems, setInvoiceItems] = useState([])
  const [manualCosts, setManualCosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState('tutte')
  const [overrides, setOverrides] = useState({})
  // Voce selezionata per drill-down (null | 'ricavi' | 'food' | 'beverage' | 'materiali' | 'personale' | 'struttura' | 'altro' | 'totCosti' | 'mol')
  const [drillVoce, setDrillVoce] = useState(null)
  const drillRef = useRef(null)

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    const [{ data: invs }, { data: items }, { data: mappings }, { data: mcs }] = await Promise.all([
      supabase.from('warehouse_invoices').select('*').order('data', { ascending: false }),
      supabase.from('warehouse_invoice_items').select('*, warehouse_invoices!inner(fornitore, data, locale, numero)'),
      supabase.from('category_mappings').select('nome_prodotto, category'),
      supabase.from('manual_costs').select('*'),
    ])
    setInvoices(invs || [])
    setInvoiceItems(items || [])
    setManualCosts(mcs || [])
    // Carica mappature apprese nel cache globale
    const learned = {}
    ;(mappings || []).forEach(m => { learned[m.nome_prodotto.toLowerCase().trim()] = m.category })
    setLearnedCache(learned)
    setLoading(false)
  }, [])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  // Scrolla al pannello di drill-down quando cambia voce selezionata
  useEffect(() => {
    if (drillVoce && drillRef.current) {
      drillRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [drillVoce])

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

  // Override categoria + impara per il futuro (salva su Supabase)
  const setCategory = async (itemId, newCat) => {
    setOverrides(prev => ({ ...prev, [itemId]: newCat }))
    // Impara: salva nome_prodotto → categoria su DB per auto-classificazione futura
    const item = categorizedItems.find(it => it.id === itemId)
    if (item && item.nome_fattura) {
      const key = item.nome_fattura.toLowerCase().trim()
      // Aggiorna cache in-memory
      const learned = getLearnedCategories()
      learned[key] = newCat
      setLearnedCache({ ...learned })
      // Salva su Supabase (upsert)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('category_mappings').upsert({
          user_id: user.id,
          nome_prodotto: key,
          category: newCat,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,nome_prodotto' })
      }
    }
  }

  const confidenceBadge = (conf) => {
    const colors = {
      appresa: { c: '#10B981', bg: 'rgba(16,185,129,.12)', label: 'Appresa ✓' },
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
              { label: '📈 RICAVI', val: ce.ricavi, bold: true, color: '#10B981', voce: 'ricavi' },
              { label: '🍕 Food cost', val: -ce.foodCost, color: '#EF4444', voce: 'food' },
              { label: '🍺 Beverage cost', val: -ce.bevCost, color: '#EF4444', voce: 'beverage' },
              { label: '📦 Mat. consumo', val: -ce.matCost, color: '#EF4444', voce: 'materiali' },
              { label: '👥 Personale', val: -(ce.persCost || 0), color: '#EF4444', voce: 'personale' },
              { label: '🏗️ Struttura', val: -ce.strCost, color: '#EF4444', voce: 'struttura' },
              { label: '── TOTALE COSTI', val: -ce.totCosti, bold: true, color: '#EF4444', voce: 'totCosti' },
              { label: '📊 MOL', val: ce.mol, bold: true, color: '#10B981', voce: 'mol' },
            ].map((r, i) => {
              const isActive = drillVoce === r.voce
              return (
                <tr key={i} style={{ borderBottom: '1px solid #1a1f2e', background: isActive ? 'rgba(245,158,11,.08)' : r.bold ? '#131825' : 'transparent', cursor: r.voce ? 'pointer' : 'default' }}
                  onClick={() => r.voce && setDrillVoce(isActive ? null : r.voce)}>
                  <td style={{ ...S.td, fontWeight: r.bold ? 700 : 400, color: isActive ? '#F59E0B' : undefined }}>
                    {r.label}
                    {r.voce && <span style={{ marginLeft: 6, fontSize: 10, color: isActive ? '#F59E0B' : '#64748b' }}>{isActive ? '▼' : '▶'}</span>}
                  </td>
                  <td style={{ ...S.td, fontWeight: r.bold ? 700 : 500, color: r.color || '#e2e8f0' }}>{fmt(Math.abs(r.val))}</td>
                  <td style={{ ...S.td, color: '#64748b' }}>{pct(Math.abs(r.val), ce.ricavi)}</td>
                  <td style={{ ...S.td, color: '#475569', fontSize: 11 }}>
                    {CATEGORY_RULES[r.voce] && <span style={S.badge(isActive ? '#F59E0B' : '#475569', isActive ? 'rgba(245,158,11,.12)' : 'rgba(71,85,105,.12)')}>
                      {catCounts[r.voce] || 0} prodotti
                    </span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 8, fontSize: 11, color: '#475569' }}>
          Clicca su una voce per vedere tutto cio' che la compone
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

    {/* DRILL-DOWN voce CE selezionata */}
    {drillVoce && <div ref={drillRef} style={{ marginTop: 12 }}>
      <DrillPanel
        voce={drillVoce}
        ce={ce}
        from={from}
        to={to}
        categorizedItems={categorizedItems}
        categorizedInvoices={categorizedInvoices}
        manualCosts={manualCosts}
        onClose={() => setDrillVoce(null)}
      />
    </div>}

    {/* COSTI MANUALI (affitto, utenze, ecc.) */}
    <div style={{ marginTop: 12 }}>
      <ManualCostsManager from={from} to={to} onChanged={() => { if (typeof reload === 'function') reload() }} />
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
                      <select value={inv._cat} onChange={async e => {
                        const newCat = e.target.value
                        setOverrides(prev => ({ ...prev, ['inv-' + inv.id]: newCat }))
                        // Impara per fornitore (per fatture senza righe)
                        if (inv.fornitore) {
                          const key = inv.fornitore.toLowerCase().trim()
                          const learned = getLearnedCategories()
                          learned[key] = newCat
                          setLearnedCache({ ...learned })
                          const { data: { user } } = await supabase.auth.getUser()
                          if (user) {
                            await supabase.from('category_mappings').upsert({
                              user_id: user.id, nome_prodotto: key, category: newCat,
                              updated_at: new Date().toISOString(),
                            }, { onConflict: 'user_id,nome_prodotto' })
                          }
                        }
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

// ─── Pannello drill-down per una voce CE selezionata ────────────────────
function DrillPanel({ voce, ce, from, to, categorizedItems, categorizedInvoices, manualCosts, onClose }) {
  const label = {
    ricavi: '📈 RICAVI', food: '🍕 Food cost', beverage: '🍺 Beverage cost',
    materiali: '📦 Mat. consumo', personale: '👥 Personale', struttura: '🏗️ Struttura',
    altro: '📄 Non categorizzate', totCosti: '── TOTALE COSTI', mol: '📊 MOL',
  }[voce] || voce

  const totale = voce === 'ricavi' ? ce.ricavi
    : voce === 'food' ? ce.foodCost
    : voce === 'beverage' ? ce.bevCost
    : voce === 'materiali' ? ce.matCost
    : voce === 'personale' ? (ce.persCost || 0)
    : voce === 'struttura' ? ce.strCost
    : voce === 'altro' ? (ce.altCost || 0)
    : voce === 'totCosti' ? ce.totCosti
    : voce === 'mol' ? ce.mol
    : 0

  // Filtra righe fatture / costi manuali per voce (solo per voci-costo)
  const isVoceCosto = CATEGORY_RULES[voce] || voce === 'altro'
  const itemsVoce = isVoceCosto ? categorizedItems.filter(it => it._cat === voce) : []
  const invoicesNoItemsVoce = isVoceCosto ? categorizedInvoices.filter(i => !i._hasItems && i._cat === voce) : []
  const manualVoce = isVoceCosto ? (manualCosts || []).filter(c => c.voce === voce).map(c => ({ ...c, _inPeriod: expandManualCost(c, from, to) })).filter(c => c._inPeriod > 0) : []

  // Totali
  const totFatt = itemsVoce.reduce((s, it) => s + Math.abs(Number(it.prezzo_totale) || 0), 0)
    + invoicesNoItemsVoce.reduce((s, inv) => s + Math.abs(Number(inv.totale) || 0), 0)
  const totManuali = manualVoce.reduce((s, c) => s + c._inPeriod, 0)

  // Raggruppa fatture per fornitore (aggregato)
  const byForn = {}
  itemsVoce.forEach(it => {
    const f = it.warehouse_invoices?.fornitore || '—'
    if (!byForn[f]) byForn[f] = { fornitore: f, totale: 0, count: 0 }
    byForn[f].totale += Math.abs(Number(it.prezzo_totale) || 0)
    byForn[f].count++
  })
  invoicesNoItemsVoce.forEach(inv => {
    const f = inv.fornitore || '—'
    if (!byForn[f]) byForn[f] = { fornitore: f, totale: 0, count: 0 }
    byForn[f].totale += Math.abs(Number(inv.totale) || 0)
    byForn[f].count++
  })
  const fornSorted = Object.values(byForn).sort((a, b) => b.totale - a.totale)

  return <Card
    title={'Dettaglio · ' + label}
    badge={fmtD(totale)}
    extra={
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>✕ Chiudi</button>
    }
  >
    {/* RICAVI */}
    {voce === 'ricavi' && <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KPI label="Scontrini" icon="🧾" value={fmtN(ce.scontrini || 0)} accent="#3B82F6" />
        <KPI label="Coperti" icon="🍽️" value={fmtN(ce.coperti || 0)} accent="#F97316" />
        <KPI label="Scontrino medio" icon="💶" value={fmt(ce.medio || 0)} accent="#10B981" />
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
        I ricavi vengono dagli scontrini CiC del periodo {from} → {to}.
        Per il dettaglio per giorno, fascia oraria, reparto e categoria consulta il tab <strong>Panoramica</strong> e <strong>Produttività</strong>.
      </div>
    </div>}

    {/* VOCI COSTO (food/beverage/materiali/personale/struttura/altro) */}
    {isVoceCosto && <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <KPI label="Da fatture" icon="🧾" value={fmtD(totFatt)} sub={(itemsVoce.length + invoicesNoItemsVoce.length) + ' righe'} accent="#3B82F6" />
        <KPI label="Costi manuali" icon="📝" value={fmtD(totManuali)} sub={manualVoce.length + ' voci nel periodo'} accent="#8B5CF6" />
        <KPI label="Totale voce" icon="💰" value={fmtD(totFatt + totManuali)} sub={pct(totFatt + totManuali, ce.ricavi) + ' su ricavi'} accent="#F59E0B" />
      </div>

      {/* Costi manuali di questa voce */}
      {manualVoce.length > 0 && <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#8B5CF6', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>📝 Costi manuali ({manualVoce.length})</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Descrizione', 'Importo singolo', 'Cadenza', 'Nel periodo'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {manualVoce.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 500 }}>{c.label}</td>
                <td style={{ ...S.td, color: '#64748b' }}>{fmtD(c.importo)}</td>
                <td style={{ ...S.td, fontSize: 12, color: c.ricorrente ? '#8B5CF6' : '#64748b' }}>{c.ricorrente ? c.cadenza : 'Puntuale'}</td>
                <td style={{ ...S.td, fontWeight: 600, color: '#10B981' }}>{fmtD(c._inPeriod)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {/* Top fornitori */}
      {fornSorted.length > 0 && <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>🏭 Top fornitori (da fatture)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Fornitore', 'Righe', 'Totale', '% voce'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {fornSorted.slice(0, 15).map(f => (
              <tr key={f.fornitore} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 500 }}>{f.fornitore}</td>
                <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{f.count}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{fmtD(f.totale)}</td>
                <td style={{ ...S.td, color: '#F59E0B' }}>{totFatt > 0 ? (f.totale / totFatt * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {/* Righe dettaglio */}
      {itemsVoce.length > 0 && <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>📋 Dettaglio righe ({itemsVoce.length})</div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#1a1f2e' }}><tr style={{ borderBottom: '1px solid #2a3042' }}>
              {['Data', 'Fornitore', 'Descrizione', 'Qty', 'Importo'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {itemsVoce.slice(0, 500).sort((a, b) => (b.warehouse_invoices?.data || '').localeCompare(a.warehouse_invoices?.data || '')).map((it, i) => (
                <tr key={it.id || i} style={{ borderBottom: '1px solid #1a1f2e' }}>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{it.warehouse_invoices?.data || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{it.warehouse_invoices?.fornitore || '—'}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{it.nome_fattura || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>{it.quantita ? fmtN(it.quantita) + ' ' + (it.unita || '') : '—'}</td>
                  <td style={{ ...S.td, fontWeight: 600, fontSize: 12 }}>{fmtD(Math.abs(Number(it.prezzo_totale) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {itemsVoce.length > 500 && <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Mostrate le prime 500 righe su {itemsVoce.length}</div>}
      </div>}

      {itemsVoce.length === 0 && manualVoce.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: '#475569' }}>
          Nessun dato nel periodo selezionato per questa voce.
        </div>
      )}
    </div>}

    {/* TOTALE COSTI */}
    {voce === 'totCosti' && <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#94a3b8' }}>Somma di tutti i costi (fatture + manuali + personnel):</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {[
            ['🍕 Food', ce.foodCost],
            ['🍺 Beverage', ce.bevCost],
            ['📦 Mat. consumo', ce.matCost],
            ['👥 Personale', ce.persCost || 0],
            ['🏗️ Struttura', ce.strCost],
            ['📄 Non categorizzato', ce.altCost || 0],
          ].map(([lbl, val], i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1a1f2e' }}>
              <td style={S.td}>{lbl}</td>
              <td style={{ ...S.td, fontWeight: 600, color: '#EF4444' }}>{fmtD(val)}</td>
              <td style={{ ...S.td, color: '#64748b' }}>{pct(val, ce.totCosti)}</td>
            </tr>
          ))}
          <tr style={{ background: '#131825', fontWeight: 700 }}>
            <td style={S.td}>── TOTALE</td>
            <td style={{ ...S.td, color: '#EF4444' }}>{fmtD(ce.totCosti)}</td>
            <td style={{ ...S.td, color: '#64748b' }}>{pct(ce.totCosti, ce.ricavi)}</td>
          </tr>
        </tbody>
      </table>
    </div>}

    {/* MOL */}
    {voce === 'mol' && <div>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#94a3b8' }}>MOL = Ricavi − Totale costi:</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr style={{ borderBottom: '1px solid #1a1f2e' }}>
            <td style={S.td}>📈 Ricavi</td>
            <td style={{ ...S.td, fontWeight: 600, color: '#10B981' }}>+ {fmtD(ce.ricavi)}</td>
          </tr>
          <tr style={{ borderBottom: '1px solid #1a1f2e' }}>
            <td style={S.td}>── Totale costi</td>
            <td style={{ ...S.td, fontWeight: 600, color: '#EF4444' }}>− {fmtD(ce.totCosti)}</td>
          </tr>
          <tr style={{ background: '#131825', fontWeight: 700 }}>
            <td style={S.td}>📊 MOL</td>
            <td style={{ ...S.td, color: ce.mol >= 0 ? '#10B981' : '#EF4444' }}>{fmtD(ce.mol)}</td>
          </tr>
          <tr>
            <td style={S.td}>MOL %</td>
            <td style={{ ...S.td, fontWeight: 600, color: '#F59E0B' }}>{ce.molPct?.toFixed(1) || 0}%</td>
          </tr>
        </tbody>
      </table>
    </div>}
  </Card>
}
