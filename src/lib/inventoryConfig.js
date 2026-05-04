// Helper centralizzato per gestione modalità conteggio inventario "pezzi + aperto".
// Usato da:
//   - InventoryManager.jsx (dashboard)
//   - TimbraPage.jsx → InventoryPanel mobile
//   - api/attendance.js (server-side, replicato inline per dependency-free)
//
// Un articolo può essere in modalità:
//   'unita' → un solo numero in unità ricetta (litri/kg, come oggi)
//   'pezzi' → due numeri: pezzi chiusi + aperto (residuo ml/cl/g)
//             il totale in unità ricetta è: pezzi * volume_pezzo + aperto / fattore
//
// volume_pezzo è SEMPRE espresso in unità ricetta (es. 0.75 L per bottiglia 75cl).
// unita_apertura indica come viene espresso il residuo aperto (ml/cl/l/g).

import { supabase } from './supabase'

// Conversione unita_apertura → unità ricetta (litri/kg).
// Es. ml → litri = / 1000 ; cl → litri = / 100
export function aperturaToUnita(qty, unita_apertura) {
  if (qty == null || qty === '') return 0
  const n = Number(qty)
  if (Number.isNaN(n)) return 0
  switch ((unita_apertura || 'ml').toLowerCase()) {
    case 'ml': return n / 1000
    case 'cl': return n / 100
    case 'g':  return n / 1000
    case 'l':
    case 'kg':
    default:   return n
  }
}

// Calcola giacenza_reale in unità ricetta da pezzi+aperto.
export function calcGiacenzaReale({ qty_pezzi, qty_aperto, volume_pezzo, unita_apertura }) {
  const pz = Number(qty_pezzi || 0) * Number(volume_pezzo || 0)
  const ap = aperturaToUnita(qty_aperto, unita_apertura)
  return Math.round((pz + ap) * 10000) / 10000  // 4 decimali
}

// Carica config per (locale, lista nomi articolo). Ritorna mappa { nome_articolo: config }.
export async function loadConfigsForArticles(locale, nomiArticoli) {
  if (!locale || !Array.isArray(nomiArticoli) || nomiArticoli.length === 0) return {}
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const { data } = await supabase.from('article_inventory_config')
    .select('*')
    .eq('user_id', user.id).eq('locale', locale)
    .in('nome_articolo', nomiArticoli)
  const map = {}
  for (const c of (data || [])) map[c.nome_articolo] = c
  return map
}

export async function loadAllConfigs(locale) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const { data } = await supabase.from('article_inventory_config')
    .select('*')
    .eq('user_id', user.id).eq('locale', locale)
  const map = {}
  for (const c of (data || [])) map[c.nome_articolo] = c
  return map
}

export async function upsertConfig(cfg) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('non autenticato')
  const payload = {
    user_id: user.id,
    locale: cfg.locale,
    nome_articolo: cfg.nome_articolo,
    modalita: cfg.modalita || 'unita',
    volume_pezzo: cfg.modalita === 'pezzi' ? Number(cfg.volume_pezzo || 0) : null,
    unita_pezzo: cfg.unita_pezzo || 'pz',
    unita_apertura: cfg.unita_apertura || 'ml',
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('article_inventory_config')
    .upsert(payload, { onConflict: 'user_id,locale,nome_articolo' })
    .select().maybeSingle()
  if (error) throw error
  return data
}

export async function deleteConfig(locale, nome_articolo) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('article_inventory_config').delete()
    .eq('user_id', user.id).eq('locale', locale).eq('nome_articolo', nome_articolo)
}
