// ─── Semilavorati / sub-ricette ───────────────────────────────────────
// Un "manual article" e' un ingrediente che produciamo internamente,
// composto da altri ingredienti del magazzino (e/o altri semilavorati).
//
// Esempio: "Salsa Remembeer" 0.6 KG (resa) = 0.5 KG pomodoro + 0.1 KG cipolla.
// Costo /KG = somma costi ingredienti / resa.

import { supabase } from './supabase'

// Conversione in unita' base coerente con quella usata in RecipeManager.calcCost
export function toBaseUnit(qty, um) {
  const q = Number(qty) || 0
  const u = (um || 'PZ').toLowerCase()
  if (u === 'g') return { qty: q / 1000, baseUm: 'KG' }
  if (u === 'cl') return { qty: q / 100, baseUm: 'LT' }
  if (u === 'ml') return { qty: q / 1000, baseUm: 'LT' }
  return { qty: q, baseUm: (um || 'PZ').toUpperCase() }
}

// Costo €/UM di un singolo ingrediente:
//   - se `nome_articolo` corrisponde a un manual_article ricorre sulla sub-ricetta
//   - altrimenti cerca prezzo medio in `articlesPriceByName` (mappa nome€/UM)
//
// `manualByName`: { nome { unita, resa, ingredienti } }
// `articlesPriceByName`: { nome (lower) €/UM_base }
// `placeholdersByName`: opzionale, { nome_norm prezzo_stimato, unita } per fallback
//
// Ritorna { perUnit, baseUm, missing[], stimaCount } dove perUnit e' €/baseUm,
// missing[] elenca eventuali ingredienti non trovati (prezzo 0),
// stimaCount conta quanti ingredienti hanno usato un prezzo stimato.
export function unitCostOf(nome, articlesPriceByName, manualByName, depth = 0, placeholdersByName = null) {
  if (depth > 8) return { perUnit: 0, baseUm: 'PZ', missing: ['LOOP:' + nome], stima: false } // protezione cicli
  const key = (nome || '').trim().toLowerCase()
  // Manual article ricorri
  if (manualByName[key]) {
    return costOfManualArticle(manualByName[key], articlesPriceByName, manualByName, depth + 1, placeholdersByName)
  }
  // Articolo magazzino
  const v = articlesPriceByName[key]
  if (v && v.perUnit > 0) return { perUnit: v.perUnit, baseUm: v.baseUm || 'PZ', missing: [], stima: false }
  // Fallback: placeholder con prezzo stimato
  if (placeholdersByName) {
    const ph = placeholdersByName[key]
    if (ph && ph.prezzo_stimato != null && Number(ph.prezzo_stimato) > 0) {
      return { perUnit: Number(ph.prezzo_stimato), baseUm: (ph.unita || 'PZ').toUpperCase(), missing: [], stima: true }
    }
  }
  return { perUnit: 0, baseUm: 'PZ', missing: [nome], stima: false }
}

// Costo di un manual_article completo: somma ingredienti / resa
export function costOfManualArticle(art, articlesPriceByName, manualByName, depth = 0, placeholdersByName = null) {
  const resa = Number(art.resa) || 1
  let totalCost = 0
  const missing = []
  let stimaCount = 0
  for (const ingr of (art.ingredienti || [])) {
    const base = toBaseUnit(ingr.quantita, ingr.unita)
    const r = unitCostOf(ingr.nome_articolo, articlesPriceByName, manualByName, depth + 1, placeholdersByName)
    if (r.missing && r.missing.length) missing.push(...r.missing)
    if (r.stima) stimaCount++
    totalCost += base.qty * (r.perUnit || 0)
  }
  // Costo per unita' base prodotta
  const baseResa = toBaseUnit(resa, art.unita)
  const perUnit = baseResa.qty > 0 ? totalCost / baseResa.qty : 0
  return { perUnit, baseUm: baseResa.baseUm, missing, totalCost, resa: baseResa.qty, stima: stimaCount > 0, stimaCount }
}

export async function loadManualArticles() {
  const { data } = await supabase.from('manual_articles').select('*').order('nome')
  return data || []
}
