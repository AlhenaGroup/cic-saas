// Budget model: formule, driver, simulatore. Puro JS, zero React/Supabase.
// Fase 1 della spec "Budget, Forecast & Simulatore Direzionale".

// ─── Categorie del conto economico ─────────────────────────────────────────
// MOL è derivato, NON uno stato: mol = ricavi - (food + beverage + materiali + personale + struttura)
export const CATS = ['ricavi', 'food', 'beverage', 'materiali', 'personale', 'struttura']

export const CAT_META = {
  ricavi:    { label: 'Ricavi',     color: '#10B981', sign: 'positive' },
  food:      { label: 'Food cost',  color: '#F59E0B', sign: 'negative' },
  beverage:  { label: 'Beverage',   color: '#3B82F6', sign: 'negative' },
  materiali: { label: 'Materiali',  color: '#8B5CF6', sign: 'negative' },
  personale: { label: 'Personale',  color: '#EC4899', sign: 'negative' },
  struttura: { label: 'Struttura',  color: 'var(--text3)', sign: 'negative' },
}

// ─── Driver standard ───────────────────────────────────────────────────────
// Ogni driver definisce come calcolare l'amount di una categoria del budget.
// `compute(cfg, ctx)` numero (importo €)
// `ctx` contiene {ricavi} per i driver percentuali.

export const DRIVERS = {
  coperti_x_medio: {
    applicableTo: ['ricavi'],
    label: 'Coperti × coperto medio',
    fields: [
      { key: 'coperti',      label: 'Coperti mese',  unit: 'nr', default: 1800, step: 10 },
      { key: 'copertoMedio', label: 'Coperto medio', unit: '€',  default: 26,   step: 0.5 },
    ],
    compute: (cfg) => (Number(cfg.coperti) || 0) * (Number(cfg.copertoMedio) || 0),
  },
  pct_ricavi: {
    applicableTo: ['food', 'beverage', 'materiali'],
    label: '% su ricavi',
    fields: [
      { key: 'pct', label: '%', unit: '%', default: 22, step: 0.5 },
    ],
    compute: (cfg, ctx) => ((Number(ctx?.ricavi) || 0) * (Number(cfg.pct) || 0)) / 100,
  },
  personale_headcount: {
    applicableTo: ['personale'],
    label: 'Organico × costo medio',
    fields: [
      { key: 'headcount',  label: 'FTE medi',             unit: 'nr', default: 10,   step: 0.5 },
      { key: 'costoMedio', label: 'Costo medio FTE/mese', unit: '€',  default: 2100, step: 50 },
    ],
    compute: (cfg) => (Number(cfg.headcount) || 0) * (Number(cfg.costoMedio) || 0),
  },
  personale_dettaglio: {
    applicableTo: ['personale'],
    label: 'Dettaglio per dipendente',
    fields: [
      // Editor custom: il driver_config contiene { dipendenti: [], altre_voci: [] }
      // I "fields" qui sono solo placeholder — la UI usa <PersonaleDettaglioEditor>.
    ],
    compute: (cfg) => {
      const dipendenti = Array.isArray(cfg?.dipendenti) ? cfg.dipendenti : []
      const altre = Array.isArray(cfg?.altre_voci) ? cfg.altre_voci : []
      let total = 0
      for (const d of dipendenti) {
        if (d?.attivo === false) continue
        const costoLavoro = Number(d?.costo_lavoro) || 0
        const bpGiorni = Number(d?.buono_pasto_giorni) || 0
        const bpValore = Number(d?.buono_pasto_valore) || 0
        const welfare = Number(d?.welfare) || 0
        const splitPct = d?.split_pct == null ? 100 : Number(d.split_pct)
        const baseRiga = costoLavoro + (bpGiorni * bpValore) + welfare
        total += baseRiga * (splitPct / 100)
      }
      for (const v of altre) {
        total += Number(v?.amount) || 0
      }
      return total
    },
    // Helper per breakdown nel CE / overview
    breakdown: (cfg) => {
      const dipendenti = Array.isArray(cfg?.dipendenti) ? cfg.dipendenti : []
      const altre = Array.isArray(cfg?.altre_voci) ? cfg.altre_voci : []
      const out = { costo_lavoro: 0, buoni_pasto: 0, welfare: 0, altre: 0 }
      for (const d of dipendenti) {
        if (d?.attivo === false) continue
        const split = (d?.split_pct == null ? 100 : Number(d.split_pct)) / 100
        out.costo_lavoro += (Number(d?.costo_lavoro) || 0) * split
        out.buoni_pasto += ((Number(d?.buono_pasto_giorni) || 0) * (Number(d?.buono_pasto_valore) || 0)) * split
        out.welfare += (Number(d?.welfare) || 0) * split
      }
      for (const v of altre) out.altre += Number(v?.amount) || 0
      return out
    },
  },
  fissa: {
    applicableTo: ['food', 'beverage', 'materiali', 'personale', 'struttura'],
    label: 'Importo fisso',
    fields: [
      { key: 'amount', label: 'Importo', unit: '€', default: 0, step: 100 },
    ],
    compute: (cfg) => Number(cfg.amount) || 0,
  },
}

// Helper: lista driver applicabili ad una categoria
export function driversForCategory(category) {
  return Object.entries(DRIVERS)
    .filter(([, d]) => d.applicableTo.includes(category))
    .map(([key, d]) => ({ key, ...d }))
}

// Default: driver raccomandato per ciascuna categoria
export const DEFAULT_DRIVER = {
  ricavi:    'coperti_x_medio',
  food:      'pct_ricavi',
  beverage:  'pct_ricavi',
  materiali: 'pct_ricavi',
  personale: 'personale_headcount',
  struttura: 'fissa',
}

// ─── Formule base (spec sezione 25) ────────────────────────────────────────
// Tutte accettano uno state object con campi numerici delle 6 categorie + coperti.

export const computeTotCosti = (s = {}) =>
  (Number(s.food) || 0) + (Number(s.beverage) || 0) + (Number(s.materiali) || 0) +
  (Number(s.personale) || 0) + (Number(s.struttura) || 0)

export const computeMOL = (s = {}) => (Number(s.ricavi) || 0) - computeTotCosti(s)

export const computeMolPct = (s = {}) => {
  const r = Number(s.ricavi) || 0
  return r > 0 ? (computeMOL(s) / r) * 100 : 0
}

export const computeFoodPct = (s = {}) => {
  const r = Number(s.ricavi) || 0
  return r > 0 ? ((Number(s.food) || 0) / r) * 100 : 0
}

export const computeBevPct = (s = {}) => {
  const r = Number(s.ricavi) || 0
  return r > 0 ? ((Number(s.beverage) || 0) / r) * 100 : 0
}

export const computePersPct = (s = {}) => {
  const r = Number(s.ricavi) || 0
  return r > 0 ? ((Number(s.personale) || 0) / r) * 100 : 0
}

export const computeMatPct = (s = {}) => {
  const r = Number(s.ricavi) || 0
  return r > 0 ? ((Number(s.materiali) || 0) / r) * 100 : 0
}

export const computeCopertoMedio = (s = {}) => {
  const c = Number(s.coperti) || 0
  return c > 0 ? (Number(s.ricavi) || 0) / c : 0
}

export const computeProduttivita = (s = {}) => {
  // €/coperto generato (inverso del food cost per coperto + anche un'indicazione di efficienza)
  const c = Number(s.coperti) || 0
  return c > 0 ? (Number(s.personale) || 0) / c : 0
}

// Break-even: ricavi minimi per MOL = 0.
// Approx Fase 1: food+beverage+materiali = variabili, personale+struttura = fissi.
export function computeBreakEven(s = {}) {
  const ricavi = Number(s.ricavi) || 0
  if (ricavi <= 0) return 0
  const varCost = (Number(s.food) || 0) + (Number(s.beverage) || 0) + (Number(s.materiali) || 0)
  const varPct = varCost / ricavi
  const fixed = (Number(s.personale) || 0) + (Number(s.struttura) || 0)
  const denom = 1 - varPct
  return denom > 0 ? fixed / denom : 0
}

// ─── Simulatore: applyLevers ───────────────────────────────────────────────
// Lever types supported in Fase 1:
//   {type:'copertoMedio',  delta:+2}              ricavi += coperti * delta
//   {type:'coperti',       deltaPct:+5}           coperti *= 1+deltaPct/100 ricavi scala
//   {type:'foodPct',       delta:-1}              food = ricavi * (foodPct + delta)/100
//   {type:'bevPct',        delta:-0.5}            beverage idem
//   {type:'assunzione',    costoMese:2100}        personale += costoMese
//   {type:'marketing',     costoMese:800, upliftCopertiPct:+3}  struttura += costoMese
//                                                                 coperti uplift + ricavi/food/bev scalati
//   {type:'struttura',     deltaEuro:+500}        struttura += deltaEuro

export function applyLevers(base, levers = []) {
  let s = { ...base }
  for (const L of levers || []) {
    if (!L || !L.type) continue
    switch (L.type) {
      case 'copertoMedio': {
        const delta = Number(L.delta) || 0
        const coperti = Number(s.coperti) || 0
        // ricavi nuovo = coperti * (coperto_medio_attuale + delta)
        const medioAttuale = computeCopertoMedio(s)
        s.ricavi = coperti * (medioAttuale + delta)
        break
      }
      case 'coperti': {
        const deltaPct = Number(L.deltaPct) || 0
        const mult = 1 + deltaPct / 100
        const medio = computeCopertoMedio(s)
        s.coperti = (Number(s.coperti) || 0) * mult
        s.ricavi = (s.coperti || 0) * medio
        // Food/Bev/Mat scalano proporzionalmente (stesso %)
        const foodPct = computeFoodPct(base)
        const bevPct = computeBevPct(base)
        const matPct = computeMatPct(base)
        s.food = (s.ricavi * foodPct) / 100
        s.beverage = (s.ricavi * bevPct) / 100
        s.materiali = (s.ricavi * matPct) / 100
        break
      }
      case 'foodPct': {
        const delta = Number(L.delta) || 0
        const newPct = computeFoodPct(s) + delta
        s.food = ((Number(s.ricavi) || 0) * newPct) / 100
        break
      }
      case 'bevPct': {
        const delta = Number(L.delta) || 0
        const newPct = computeBevPct(s) + delta
        s.beverage = ((Number(s.ricavi) || 0) * newPct) / 100
        break
      }
      case 'assunzione': {
        const cost = Number(L.costoMese) || 0
        s.personale = (Number(s.personale) || 0) + cost
        break
      }
      case 'marketing': {
        const cost = Number(L.costoMese) || 0
        s.struttura = (Number(s.struttura) || 0) + cost
        const uplift = Number(L.upliftCopertiPct) || 0
        if (uplift) {
          const medio = computeCopertoMedio(s)
          s.coperti = (Number(s.coperti) || 0) * (1 + uplift / 100)
          s.ricavi = (s.coperti || 0) * medio
          // Ricalcola food/bev legati a ricavi mantenendo i % correnti
          const foodPct = computeFoodPct(base)
          const bevPct = computeBevPct(base)
          s.food = (s.ricavi * foodPct) / 100
          s.beverage = (s.ricavi * bevPct) / 100
        }
        break
      }
      case 'struttura': {
        const delta = Number(L.deltaEuro) || 0
        s.struttura = (Number(s.struttura) || 0) + delta
        break
      }
      default:
        // unknown lever type, skip
        break
    }
  }
  // Rigenera derivati
  s.totCosti = computeTotCosti(s)
  s.mol = computeMOL(s)
  s.molPct = computeMolPct(s)
  return s
}

// ─── Metadata lever per UI ─────────────────────────────────────────────────
export const LEVER_TYPES = {
  copertoMedio: {
    label: 'Coperto medio',
    description: 'Aumenta o riduci il coperto medio in €',
    fields: [{ key: 'delta', label: 'Δ €', unit: '€', default: 1, step: 0.5 }],
  },
  coperti: {
    label: 'Coperti',
    description: 'Variazione % del numero di coperti',
    fields: [{ key: 'deltaPct', label: 'Δ %', unit: '%', default: 5, step: 1 }],
  },
  foodPct: {
    label: 'Food cost %',
    description: 'Modifica punti percentuali food cost (es. −1 = -1 punto)',
    fields: [{ key: 'delta', label: 'Δ punti', unit: 'p', default: -1, step: 0.5 }],
  },
  bevPct: {
    label: 'Beverage cost %',
    description: 'Modifica punti percentuali beverage cost',
    fields: [{ key: 'delta', label: 'Δ punti', unit: 'p', default: -0.5, step: 0.5 }],
  },
  assunzione: {
    label: 'Assunzione',
    description: 'Nuova risorsa: aggiunge costo mensile al personale',
    fields: [{ key: 'costoMese', label: 'Costo/mese', unit: '€', default: 2100, step: 100 }],
  },
  marketing: {
    label: 'Marketing',
    description: 'Investimento marketing con uplift coperti atteso',
    fields: [
      { key: 'costoMese',        label: 'Budget/mese',  unit: '€', default: 800, step: 100 },
      { key: 'upliftCopertiPct', label: 'Uplift coperti', unit: '%', default: 3,   step: 0.5 },
    ],
  },
  struttura: {
    label: 'Struttura',
    description: 'Variazione costi strutturali (affitto, utenze, ecc)',
    fields: [{ key: 'deltaEuro', label: 'Δ €/mese', unit: '€', default: 500, step: 100 }],
  },
}

// ─── Forecast lineare ──────────────────────────────────────────────────────
// Scala ricavi, coperti, food, beverage, materiali, struttura in base a k = daysTotal/daysElapsed.
// Personale NON scalato (costo mensile chiuso, non cresce coi giorni rimanenti).

export function computeForecast(actuals, daysElapsed, daysTotal, trendAdjustmentPct = 0) {
  if (!actuals || daysElapsed <= 0 || daysTotal <= 0) return { ...(actuals || {}) }
  const k = (daysTotal / daysElapsed) * (1 + trendAdjustmentPct / 100)
  const scale = (v) => Math.round((Number(v) || 0) * k * 100) / 100
  const out = {
    ricavi:    scale(actuals.ricavi),
    coperti:   Math.round((Number(actuals.coperti) || 0) * k),
    food:      scale(actuals.food),
    beverage:  scale(actuals.beverage),
    materiali: scale(actuals.materiali),
    personale: Number(actuals.personale) || 0, // NON scalato
    struttura: scale(actuals.struttura),
  }
  out.totCosti = computeTotCosti(out)
  out.mol = computeMOL(out)
  out.molPct = computeMolPct(out)
  return out
}

// Helper: quanti giorni del mese sono passati (rispetto a oggi)
export function daysElapsedInMonth(year, month) {
  const now = new Date()
  const isCurrent = now.getFullYear() === year && now.getMonth() + 1 === month
  if (!isCurrent) {
    // Mese passato: tutti i giorni. Mese futuro: 0.
    const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
    const totalDays = new Date(year, month, 0).getDate()
    return isPast ? totalDays : 0
  }
  return now.getDate()
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// ─── Health classifier ─────────────────────────────────────────────────────
// Ritorna array di item per i blocchi "cosa va bene" / "cosa va male" in Overview.

export function classifyHealth(consuntivo, budget) {
  if (!budget || !consuntivo) return []
  const out = []
  const push = (metric, label, actual, target, better /* 'higher'|'lower' */) => {
    if (!target || target === 0) return
    const delta = actual - target
    const pct = (delta / target) * 100
    const positive = better === 'higher' ? delta >= 0 : delta <= 0
    out.push({ metric, label, actual, target, delta, pct, positive, better })
  }

  push('ricavi',    'Ricavi',     consuntivo.ricavi    || 0, budget.ricavi    || 0, 'higher')
  push('food',      'Food cost',  consuntivo.food      || 0, budget.food      || 0, 'lower')
  push('beverage',  'Beverage',   consuntivo.beverage  || 0, budget.beverage  || 0, 'lower')
  push('materiali', 'Materiali',  consuntivo.materiali || 0, budget.materiali || 0, 'lower')
  push('personale', 'Personale',  consuntivo.personale || 0, budget.personale || 0, 'lower')
  push('struttura', 'Struttura',  consuntivo.struttura || 0, budget.struttura || 0, 'lower')

  // MOL
  const molActual = computeMOL(consuntivo)
  const molBudget = computeMOL(budget)
  if (molBudget !== 0) {
    out.push({
      metric: 'mol',
      label: 'MOL',
      actual: molActual,
      target: molBudget,
      delta: molActual - molBudget,
      pct: ((molActual - molBudget) / Math.abs(molBudget)) * 100,
      positive: molActual >= molBudget,
      better: 'higher',
    })
  }
  return out
}

// ─── Leve suggerite ────────────────────────────────────────────────────────
// Dato un health check, suggerisce leve correttive concrete.

export function suggestLevers(health) {
  const suggestions = []
  for (const h of health || []) {
    if (h.positive) continue
    if (Math.abs(h.pct) < 3) continue
    switch (h.metric) {
      case 'ricavi':
        suggestions.push({
          title: 'Recupera ricavi',
          action: `Mancano ${Math.round(-h.delta)}€. Prova +${Math.ceil(Math.abs(h.delta) / 500)}€ di coperto medio o campagna di richiamo.`,
          levers: [{ type: 'copertoMedio', delta: 1 }],
        })
        break
      case 'food':
        suggestions.push({
          title: 'Taglia food cost',
          action: `Food cost sopra budget di ${Math.abs(h.pct).toFixed(1)}%. Rivedi ricette, sprechi, fornitori.`,
          levers: [{ type: 'foodPct', delta: -1 }],
        })
        break
      case 'beverage':
        suggestions.push({
          title: 'Ottimizza beverage',
          action: `Beverage cost sopra budget. Rivedi markup su vini e drink, riduci omaggi.`,
          levers: [{ type: 'bevPct', delta: -0.5 }],
        })
        break
      case 'personale':
        suggestions.push({
          title: 'Rivedi staffing',
          action: `Costo personale sopra budget di ${Math.round(-h.delta)}€. Valuta riduzione ore improduttive.`,
          levers: [{ type: 'assunzione', costoMese: -500 }],
        })
        break
      case 'struttura':
        suggestions.push({
          title: 'Controlla costi fissi',
          action: `Struttura sopra budget di ${Math.round(-h.delta)}€. Verifica spese una tantum o nuovi contratti.`,
          levers: [{ type: 'struttura', deltaEuro: -200 }],
        })
        break
      case 'mol':
        suggestions.push({
          title: 'Recupera MOL',
          action: `MOL sotto budget di ${Math.round(-h.delta)}€. Combina +1€ coperto medio e −1 punto food cost.`,
          levers: [
            { type: 'copertoMedio', delta: 1 },
            { type: 'foodPct', delta: -1 },
          ],
        })
        break
    }
  }
  return suggestions
}
