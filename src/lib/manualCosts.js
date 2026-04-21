// ─── Manual costs: espansione ricorrenze ─────────────────────────────────
// Un costo manuale può essere:
//  - puntuale (ricorrente = false): conta solo se data_riferimento è nel periodo
//  - ricorrente: conta tante volte quante cade nel [from, to] in base a cadenza

const CADENZE = {
  settimanale: (d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n },
  mensile:     (d) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n },
  bimestrale:  (d) => { const n = new Date(d); n.setMonth(n.getMonth() + 2); return n },
  trimestrale: (d) => { const n = new Date(d); n.setMonth(n.getMonth() + 3); return n },
  semestrale:  (d) => { const n = new Date(d); n.setMonth(n.getMonth() + 6); return n },
  annuale:     (d) => { const n = new Date(d); n.setFullYear(n.getFullYear() + 1); return n },
}

// Ritorna il totale €€ di un costo manuale che cade nel [from, to].
// Per i ricorrenti, moltiplica importo × numero di occorrenze nel range.
export function expandManualCost(cost, from, to) {
  if (!cost || !cost.importo) return 0
  const importo = Number(cost.importo) || 0
  if (importo <= 0) return 0
  const fromD = new Date(from)
  const toD = new Date(to)
  if (!cost.ricorrente || !cost.cadenza) {
    // Puntuale: conta solo se la data cade nel range
    const d = new Date(cost.data_riferimento)
    return (d >= fromD && d <= toD) ? importo : 0
  }
  const step = CADENZE[cost.cadenza]
  if (!step) return 0
  // Fine ricorrenza: min(data_fine se presente, to)
  const finePeriodo = cost.data_fine ? new Date(Math.min(toD.getTime(), new Date(cost.data_fine).getTime())) : toD
  if (finePeriodo < fromD) return 0
  // Conta occorrenze
  let d = new Date(cost.data_riferimento)
  // Avanza d finché non è >= fromD (ottimizzazione per costi iniziati molto prima)
  while (d < fromD) d = step(d)
  let count = 0
  while (d <= finePeriodo) {
    count++
    d = step(d)
    // Safety: evita loop infiniti
    if (count > 10000) break
  }
  return importo * count
}

// Aggrega una lista di costi manuali per voce, dato un periodo.
// Ritorna: { food, beverage, materiali, struttura, personale, altro }
export function aggregateManualCosts(costs, from, to) {
  const agg = { food: 0, beverage: 0, materiali: 0, struttura: 0, personale: 0, altro: 0 }
  ;(costs || []).forEach(c => {
    const val = expandManualCost(c, from, to)
    if (val > 0) agg[c.voce] = (agg[c.voce] || 0) + val
  })
  return agg
}

// Label umane per le voci (duplicate dal CE ma utili se serve uno standalone)
export const VOCE_LABELS = {
  food: '🍕 Food cost',
  beverage: '🍺 Beverage cost',
  materiali: '📦 Mat. consumo',
  struttura: '🏗️ Struttura',
  personale: '👥 Personale',
  altro: '📄 Altro',
}

export const CADENZE_LABELS = {
  settimanale: 'Settimanale',
  mensile: 'Mensile',
  bimestrale: 'Bimestrale',
  trimestrale: 'Trimestrale',
  semestrale: 'Semestrale',
  annuale: 'Annuale',
}
