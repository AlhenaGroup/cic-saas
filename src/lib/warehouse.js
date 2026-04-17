// ═══════════════════════════════════════════════════════════════════════════
// Magazzino v2: helper per giacenze e movimenti
//
// Schema:
//   article_stock    → giacenza corrente per (user, locale, sub_location, articolo)
//   article_movement → storico movimenti (append-only), genera delta su stock
//
// Tipi di movimento:
//   'carico'              → +qty  (fonte: fattura | manuale)
//   'scarico'             → -qty  (fonte: scontrino | manuale | spreco)
//   'correzione'          → ±qty  (fonte: inventario)
//   'apertura'            → set   (inventario di apertura, NO correzione)
//   'trasferimento_out'   → -qty  (in un paio con trasferimento_in)
//   'trasferimento_in'    → +qty
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

// ─── Sub-location management ───────────────────────────────────────────────

// Ritorna la mappa locale -> [sub-location] dalle settings utente.
// Se un locale non ha sub-location configurate, di default c'e' solo 'principale'.
export async function getSubLocationsMap() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const { data } = await supabase.from('user_settings')
    .select('sub_locations').eq('user_id', user.id).maybeSingle()
  return data?.sub_locations || {}
}

export async function setSubLocations(locale, subLocations) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('non autenticato')
  const map = await getSubLocationsMap()
  map[locale] = subLocations.filter(Boolean).map(s => s.trim()).filter(Boolean)
  if (map[locale].length === 0) delete map[locale]
  const { error } = await supabase.from('user_settings')
    .update({ sub_locations: map, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
  if (error) throw error
  return map
}

// Di default se l'utente non ha mai configurato sub-location per un locale,
// ritorna ['principale']. Se ha configurato, ritorna la sua lista (ordinata).
export function subLocationsFor(map, locale) {
  const list = map?.[locale]
  return (Array.isArray(list) && list.length > 0) ? list : ['principale']
}

// ─── Movimenti: applica su DB un movimento + aggiorna article_stock ─────────

// Applica un movimento: inserisce riga in article_movement + upsert article_stock
// con delta corretto. Gestisce anche trasferimenti (due movimenti in coppia).
export async function applyMovement({
  locale, subLocation, nomeArticolo, tipo, quantita, unita,
  prezzoUnitario = null, fonte = 'manuale', riferimentoId = null,
  riferimentoLabel = null, subLocationTarget = null, note = null,
}) {
  if (!locale || !nomeArticolo || !tipo || quantita == null) {
    throw new Error('applyMovement: parametri mancanti')
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('non autenticato')

  const sub = subLocation || 'principale'
  const qty = Math.abs(Number(quantita) || 0)
  if (qty === 0) throw new Error('quantita non puo essere zero')

  const valoreTotale = prezzoUnitario != null ? Math.round(qty * Number(prezzoUnitario) * 100) / 100 : null

  // 1. Inserisci il movimento (storico append-only)
  const movementRows = []
  if (tipo === 'trasferimento_out' || tipo === 'trasferimento') {
    if (!subLocationTarget) throw new Error('trasferimento richiede sub_location_target')
    movementRows.push({
      user_id: user.id, locale, sub_location: sub, nome_articolo: nomeArticolo,
      tipo: 'trasferimento_out', quantita: qty, unita, prezzo_unitario: prezzoUnitario,
      valore_totale: valoreTotale, fonte: 'trasferimento',
      riferimento_id: riferimentoId, riferimento_label: riferimentoLabel,
      sub_location_target: subLocationTarget, note, created_by: user.id,
    })
    movementRows.push({
      user_id: user.id, locale, sub_location: subLocationTarget, nome_articolo: nomeArticolo,
      tipo: 'trasferimento_in', quantita: qty, unita, prezzo_unitario: prezzoUnitario,
      valore_totale: valoreTotale, fonte: 'trasferimento',
      riferimento_id: riferimentoId, riferimento_label: riferimentoLabel,
      sub_location_target: sub, note, created_by: user.id,
    })
  } else {
    movementRows.push({
      user_id: user.id, locale, sub_location: sub, nome_articolo: nomeArticolo,
      tipo, quantita: qty, unita, prezzo_unitario: prezzoUnitario,
      valore_totale: valoreTotale, fonte, riferimento_id: riferimentoId,
      riferimento_label: riferimentoLabel, note, created_by: user.id,
    })
  }
  const { error: movErr } = await supabase.from('article_movement').insert(movementRows)
  if (movErr) throw movErr

  // 2. Aggiorna article_stock (upsert con delta corretto)
  for (const m of movementRows) {
    const delta = deltaForTipo(m.tipo, m.quantita)
    await upsertStock(user.id, m.locale, m.sub_location, m.nome_articolo, m.unita, delta, m.prezzo_unitario, tipo === 'apertura')
  }
}

function deltaForTipo(tipo, qty) {
  switch (tipo) {
    case 'carico':
    case 'trasferimento_in':
      return +qty
    case 'scarico':
    case 'trasferimento_out':
      return -qty
    case 'correzione':
      return 0  // la correzione viene gestita da applyInventoryClose (set diretto)
    case 'apertura':
      return 0  // apertura fissa la quantita' direttamente (no delta)
    default:
      return 0
  }
}

async function upsertStock(userId, locale, sub, nome, unita, delta, prezzo, setDirect = false) {
  // Read-then-write (Supabase non ha UPSERT con increment atomico in REST)
  const { data: existing } = await supabase.from('article_stock')
    .select('id, quantita, prezzo_medio').eq('user_id', userId)
    .eq('locale', locale).eq('sub_location', sub)
    .eq('nome_articolo', nome).maybeSingle()
  if (existing) {
    const nuovaQty = setDirect ? delta : Math.round(((existing.quantita || 0) + delta) * 1000) / 1000
    const nuovoPrezzoMedio = prezzo != null
      ? existing.prezzo_medio
        ? Math.round((Number(existing.prezzo_medio) * 0.7 + Number(prezzo) * 0.3) * 10000) / 10000
        : Number(prezzo)
      : existing.prezzo_medio
    await supabase.from('article_stock').update({
      quantita: nuovaQty, prezzo_medio: nuovoPrezzoMedio,
      unita: unita || undefined, updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
  } else {
    await supabase.from('article_stock').insert({
      user_id: userId, locale, sub_location: sub, nome_articolo: nome,
      unita: unita || null, quantita: setDirect ? delta : delta,
      prezzo_medio: prezzo != null ? Number(prezzo) : null,
    })
  }
}

// ─── Applica inventario fisico (chiusura sessione) ─────────────────────────
// Per ogni riga: se giacenza_reale != teorica → movimento 'correzione' + set stock
export async function applyInventoryClose(inventoryId, items) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('non autenticato')
  const movements = []
  for (const it of items) {
    const diff = Number(it.giacenza_reale || 0) - Number(it.giacenza_teorica || 0)
    if (Math.abs(diff) < 0.001) continue
    movements.push({
      user_id: user.id, locale: it.locale, sub_location: it.sub_location || 'principale',
      nome_articolo: it.nome_articolo, tipo: 'correzione', quantita: Math.abs(diff),
      unita: it.unita, prezzo_unitario: it.prezzo_medio,
      valore_totale: it.prezzo_medio ? Math.round(Math.abs(diff) * Number(it.prezzo_medio) * 100) / 100 : null,
      fonte: 'inventario', riferimento_id: inventoryId,
      riferimento_label: 'Inventario ' + (it.inv_date || ''),
      note: `${it.giacenza_teorica || 0} → ${it.giacenza_reale} (diff ${diff > 0 ? '+' : ''}${diff})`,
      created_by: user.id,
    })
    // Set diretto del nuovo stock
    await upsertStock(user.id, it.locale, it.sub_location || 'principale', it.nome_articolo,
      it.unita, Number(it.giacenza_reale), it.prezzo_medio, true)
  }
  if (movements.length > 0) {
    await supabase.from('article_movement').insert(movements)
  }
}

// ─── Applica inventario di apertura ─────────────────────────────────────────
export async function applyInventoryOpening(inventoryId, items) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('non autenticato')
  const movements = []
  for (const it of items) {
    const qty = Number(it.giacenza_reale || 0)
    if (qty <= 0) continue
    movements.push({
      user_id: user.id, locale: it.locale, sub_location: it.sub_location || 'principale',
      nome_articolo: it.nome_articolo, tipo: 'apertura', quantita: qty,
      unita: it.unita, prezzo_unitario: it.prezzo_medio,
      valore_totale: it.prezzo_medio ? Math.round(qty * Number(it.prezzo_medio) * 100) / 100 : null,
      fonte: 'inventario', riferimento_id: inventoryId,
      riferimento_label: 'Apertura ' + (it.inv_date || ''),
      note: 'Inventario di apertura',
      created_by: user.id,
    })
    await upsertStock(user.id, it.locale, it.sub_location || 'principale', it.nome_articolo,
      it.unita, qty, it.prezzo_medio, true)
  }
  if (movements.length > 0) {
    await supabase.from('article_movement').insert(movements)
  }
}
