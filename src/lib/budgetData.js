// Budget data layer: I/O Supabase + aggregazioni consuntivo.
//
// Questo modulo legge i dati reali dalle tabelle esistenti (daily_stats,
// personnel_costs, warehouse_invoices/items) e li aggrega nello schema delle
// 6 categorie di budgetModel.js. Scrive/legge inoltre le nuove tabelle
// budget_periods, budget_rows, budget_scenarios.

import { supabase } from './supabase'
import { categorizeItem, CATEGORY_RULES } from '../components/ContoEconomico.jsx'
import { computeMOL, computeTotCosti } from './budgetModel.js'

// ─── Helpers ───────────────────────────────────────────────────────────────

export function startOfMonth(year, month) {
  const m = String(month).padStart(2, '0')
  return `${year}-${m}-01`
}

export function endOfMonth(year, month) {
  const d = new Date(year, month, 0) // month 1..12 → day 0 of next month = last day
  const m = String(month).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${m}-${day}`
}

// Risolve il locale: può essere 'all' (tutti), un id numerico (da sps), o già una stringa nome.
// `sps` è l'array {id, description} passato dalla DashboardPage.
function resolveLocaleName(locale, sps = []) {
  if (!locale || locale === 'all') return null
  const found = sps.find(s => String(s.id) === String(locale))
  if (found) return found.description || found.name || String(locale)
  return String(locale)
}

// ─── Consuntivo: aggrega ricavi/coperti/costi del mese dal DB ──────────────
//
// Ritorna oggetto:
//   { ricavi, coperti, food, beverage, materiali, personale, struttura,
//     totCosti, mol, molPct, daily: [{date, ricavi, coperti}] }
//
// locale: 'all' | id salespoint (string/number) | nome locale
// year: 2026
// month: 1..12
// sps: array salespoints opzionale per risolvere id → nome

export async function fetchConsuntivo(locale, year, month, sps = []) {
  const from = startOfMonth(year, month)
  const to = endOfMonth(year, month)
  const localeName = resolveLocaleName(locale, sps)

  // ── 1. Ricavi + coperti da daily_stats
  let dsQuery = supabase
    .from('daily_stats')
    .select('date, revenue, dept_records, salespoint_id, salespoint_name')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  if (locale && locale !== 'all') {
    // Se locale è un id numerico, filtra per salespoint_id, altrimenti per nome
    const asNum = Number(locale)
    if (!Number.isNaN(asNum) && String(asNum) === String(locale)) {
      dsQuery = dsQuery.eq('salespoint_id', asNum)
    } else if (localeName) {
      dsQuery = dsQuery.eq('salespoint_name', localeName)
    }
  }

  const { data: dsRows, error: dsErr } = await dsQuery
  if (dsErr) console.warn('[budgetData] daily_stats:', dsErr.message)

  let ricavi = 0
  let coperti = 0
  const dailyMap = {}

  ;(dsRows || []).forEach(row => {
    const dateStr = typeof row.date === 'string' ? row.date.substring(0, 10) : row.date
    const rRev = Number(row.revenue) || 0
    ricavi += rRev

    let dayCoperti = 0
    ;(row.dept_records || []).forEach(rec => {
      const descr = (rec.department?.description || '').toUpperCase()
      if (descr === 'COPERTO') dayCoperti += Number(rec.quantity) || 0
    })
    coperti += dayCoperti

    if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, ricavi: 0, coperti: 0 }
    dailyMap[dateStr].ricavi += rRev
    dailyMap[dateStr].coperti += dayCoperti
  })

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))

  // ── 2. Personale: costo_totale mensile da personnel_costs
  // Chiave: mese (primo giorno del mese) + locale (stringa descrittiva o 'all')
  const mesePk = from // '2026-04-01'
  let pcQuery = supabase
    .from('personnel_costs')
    .select('costo_totale, locale, mese')
    .eq('mese', mesePk)

  const { data: pcRows, error: pcErr } = await pcQuery
  if (pcErr) console.warn('[budgetData] personnel_costs:', pcErr.message)

  let personale = 0
  ;(pcRows || []).forEach(r => {
    const rowLocale = r.locale || ''
    if (locale === 'all' || !localeName) {
      // All locations → somma tutti (incluso 'all' e locali specifici)
      personale += Number(r.costo_totale) || 0
    } else {
      // Filtra per locale: stringa esatta o 'all'
      if (rowLocale === localeName || rowLocale === 'all') {
        personale += Number(r.costo_totale) || 0
      }
    }
  })

  // ── 3. Fatture del mese → classifica in food/beverage/materiali/struttura
  let invQuery = supabase
    .from('warehouse_invoices')
    .select('id, data, fornitore, locale, totale')
    .gte('data', from)
    .lte('data', to)

  if (locale && locale !== 'all' && localeName) {
    invQuery = invQuery.eq('locale', localeName)
  }
  const { data: invRows, error: invErr } = await invQuery
  if (invErr) console.warn('[budgetData] warehouse_invoices:', invErr.message)

  const invIds = (invRows || []).map(r => r.id)
  let itemRows = []
  if (invIds.length > 0) {
    const { data: items, error: itErr } = await supabase
      .from('warehouse_invoice_items')
      .select('id, invoice_id, nome_fattura, prezzo_totale')
      .in('invoice_id', invIds)
    if (itErr) console.warn('[budgetData] warehouse_invoice_items:', itErr.message)
    itemRows = items || []
  }

  // Map invoice_id → fornitore per lookup veloce
  const invById = {}
  ;(invRows || []).forEach(inv => { invById[inv.id] = inv })

  let food = 0, beverage = 0, materiali = 0, struttura = 0
  // Traccia quali fatture hanno righe classificate
  const invWithItems = new Set()

  itemRows.forEach(it => {
    const inv = invById[it.invoice_id]
    const fornitore = inv?.fornitore || ''
    const { category } = categorizeItem(fornitore, it.nome_fattura || '')
    const amount = Number(it.prezzo_totale) || 0
    if (amount <= 0) return
    invWithItems.add(it.invoice_id)
    if (category === 'food') food += amount
    else if (category === 'beverage') beverage += amount
    else if (category === 'materiali') materiali += amount
    else if (category === 'struttura') struttura += amount
    // personale da fatture viene ignorato (gestito da personnel_costs)
    // 'altro' → non conteggiato nelle 6 categorie
  })

  // Per le fatture SENZA righe dettaglio, classifica tutta la fattura per fornitore
  ;(invRows || []).forEach(inv => {
    if (invWithItems.has(inv.id)) return
    const { category } = categorizeItem(inv.fornitore || '', '')
    const amount = Number(inv.totale) || 0
    if (amount <= 0) return
    if (category === 'food') food += amount
    else if (category === 'beverage') beverage += amount
    else if (category === 'materiali') materiali += amount
    else if (category === 'struttura') struttura += amount
  })

  const state = {
    ricavi: Math.round(ricavi * 100) / 100,
    coperti,
    food: Math.round(food * 100) / 100,
    beverage: Math.round(beverage * 100) / 100,
    materiali: Math.round(materiali * 100) / 100,
    personale: Math.round(personale * 100) / 100,
    struttura: Math.round(struttura * 100) / 100,
  }
  state.totCosti = computeTotCosti(state)
  state.mol = computeMOL(state)
  state.molPct = state.ricavi > 0 ? (state.mol / state.ricavi) * 100 : 0
  return { ...state, daily }
}

// ─── Budget CRUD ───────────────────────────────────────────────────────────
//
// Tabelle:
//   budget_periods (user_id, locale, year, month, status, note)
//   budget_rows (budget_period_id, category, amount, driver_type, driver_config, notes)
//
// `localeKey` per le tabelle: usiamo lo stesso valore che arriva da DashboardPage
// ('all' per tutti i locali, oppure id stringa del salespoint). In questo modo
// un utente può avere un budget separato per ogni locale + uno aggregato.

export async function fetchBudget(locale, year, month) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const localeKey = String(locale || 'all')

  const { data: periods, error: pErr } = await supabase
    .from('budget_periods')
    .select('*')
    .eq('user_id', user.id)
    .eq('locale', localeKey)
    .eq('year', year)
    .eq('month', month)
    .limit(1)
  if (pErr) {
    console.warn('[budgetData] fetchBudget period:', pErr.message)
    return null
  }
  const period = periods && periods[0]
  if (!period) return null

  const { data: rows, error: rErr } = await supabase
    .from('budget_rows')
    .select('*')
    .eq('budget_period_id', period.id)
  if (rErr) {
    console.warn('[budgetData] fetchBudget rows:', rErr.message)
    return null
  }

  // Ricomponi lo state aggregato + mantieni array rows per l'editor
  const state = { ricavi: 0, food: 0, beverage: 0, materiali: 0, personale: 0, struttura: 0 }
  ;(rows || []).forEach(r => {
    const cat = r.category
    if (state[cat] !== undefined) state[cat] += Number(r.amount) || 0
  })
  state.totCosti = computeTotCosti(state)
  state.mol = computeMOL(state)
  state.molPct = state.ricavi > 0 ? (state.mol / state.ricavi) * 100 : 0

  return { period, rows: rows || [], state }
}

// Salva (upsert) periodo + rimpiazza righe del budget.
// rowsInput: [{category, amount, driver_type, driver_config, notes}]
export async function saveBudget(locale, year, month, rowsInput, note = '') {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')
  const localeKey = String(locale || 'all')

  // Upsert periodo
  const { data: existing, error: eErr } = await supabase
    .from('budget_periods')
    .select('id')
    .eq('user_id', user.id)
    .eq('locale', localeKey)
    .eq('year', year)
    .eq('month', month)
    .limit(1)
  if (eErr) throw new Error('Errore lettura periodo: ' + eErr.message)

  let periodId
  if (existing && existing[0]) {
    periodId = existing[0].id
    const { error: upErr } = await supabase
      .from('budget_periods')
      .update({ note, status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', periodId)
    if (upErr) throw new Error('Errore update periodo: ' + upErr.message)
  } else {
    const { data: ins, error: insErr } = await supabase
      .from('budget_periods')
      .insert({
        user_id: user.id,
        locale: localeKey,
        year,
        month,
        status: 'draft',
        note,
      })
      .select('id')
      .single()
    if (insErr) throw new Error('Errore insert periodo: ' + insErr.message)
    periodId = ins.id
  }

  // Rimpiazza righe: cancella + inserisci
  const { error: delErr } = await supabase
    .from('budget_rows')
    .delete()
    .eq('budget_period_id', periodId)
  if (delErr) throw new Error('Errore delete righe: ' + delErr.message)

  const rowsToInsert = (rowsInput || []).map(r => ({
    budget_period_id: periodId,
    category: r.category,
    subcategory: r.subcategory || null,
    amount: Number(r.amount) || 0,
    driver_type: r.driver_type || null,
    driver_config: r.driver_config || {},
    notes: r.notes || null,
  }))

  if (rowsToInsert.length > 0) {
    const { error: inErr } = await supabase.from('budget_rows').insert(rowsToInsert)
    if (inErr) throw new Error('Errore insert righe: ' + inErr.message)
  }

  return { periodId }
}

// Copia il budget dal mese precedente (stesso locale). Ritorna array rows o null.
export async function fetchPreviousBudgetRows(locale, year, month) {
  let prevY = year
  let prevM = month - 1
  if (prevM < 1) { prevM = 12; prevY = year - 1 }
  const prev = await fetchBudget(locale, prevY, prevM)
  if (!prev || !prev.rows || prev.rows.length === 0) return null
  return prev.rows.map(r => ({
    category: r.category,
    amount: Number(r.amount) || 0,
    driver_type: r.driver_type,
    driver_config: r.driver_config || {},
    notes: r.notes || '',
  }))
}

// ─── Scenari simulatore CRUD ───────────────────────────────────────────────

export async function fetchScenarios(locale) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const localeKey = String(locale || 'all')
  const { data, error } = await supabase
    .from('budget_scenarios')
    .select('*')
    .eq('user_id', user.id)
    .eq('locale', localeKey)
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('[budgetData] fetchScenarios:', error.message)
    return []
  }
  return data || []
}

export async function saveScenario(scenario) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Non autenticato')
  const payload = {
    user_id: user.id,
    name: scenario.name,
    description: scenario.description || null,
    locale: String(scenario.locale || 'all'),
    base_source: scenario.base_source || 'consuntivo',
    base_values: scenario.base_values || {},
    levers: scenario.levers || [],
    simulated_values: scenario.simulated_values || {},
    updated_at: new Date().toISOString(),
  }
  if (scenario.id) {
    const { data, error } = await supabase
      .from('budget_scenarios')
      .update(payload)
      .eq('id', scenario.id)
      .select()
      .single()
    if (error) throw new Error('Errore update scenario: ' + error.message)
    return data
  } else {
    const { data, error } = await supabase
      .from('budget_scenarios')
      .insert(payload)
      .select()
      .single()
    if (error) throw new Error('Errore insert scenario: ' + error.message)
    return data
  }
}

export async function deleteScenario(id) {
  const { error } = await supabase.from('budget_scenarios').delete().eq('id', id)
  if (error) throw new Error('Errore delete scenario: ' + error.message)
  return true
}

// Ri-export per comodità dai consumer
export { CATEGORY_RULES }
