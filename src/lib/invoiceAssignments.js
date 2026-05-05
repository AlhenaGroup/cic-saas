// ─── Assegnazioni fatture TS Digital locale ─────────────────────────
// Sync bidirezionale tra Supabase (cross-device) e localStorage (cache locale).
// Schema DB: ts_invoice_assignments (user_id, hub_id, locale, auto_assigned, item_overrides)

import { supabase } from './supabase'

const LS_LOCALE = 'cic_ts_invoice_locales'      // { hubId: locale }
const LS_AUTO   = 'cic_ts_auto_assigned'        // { hubId: true }
const LS_ITEMS  = 'cic_ts_item_locales'         // { 'hubId:idx': locale }

// Carica tutto da Supabase per l'utente corrente, fa il merge con localStorage,
// salva eventuali assegnazioni LS non ancora su DB, e ritorna lo stato unificato.
export async function loadAndSyncAssignments() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return readLocal()
  }
  // 1. Carica DB
  let dbRows = []
  try {
    const { data } = await supabase.from('ts_invoice_assignments').select('*').eq('user_id', user.id)
    dbRows = data || []
  } catch (e) { console.warn('[assignments] load db:', e.message) }

  // 2. Costruisci mappe DB
  const dbLocale = {}
  const dbAuto = {}
  const dbItems = {}
  for (const r of dbRows) {
    if (r.locale) dbLocale[r.hub_id] = r.locale
    if (r.auto_assigned) dbAuto[r.hub_id] = true
    if (r.item_overrides && typeof r.item_overrides === 'object') {
      for (const k in r.item_overrides) {
        dbItems[r.hub_id + ':' + k] = r.item_overrides[k]
      }
    }
  }

  // 3. Carica LS per la migrazione one-shot
  const lsLocale = readLs(LS_LOCALE)
  const lsAuto = readLs(LS_AUTO)
  const lsItems = readLs(LS_ITEMS)

  // 4. Trova entries LS non ancora su DB upserto
  const toUpsert = []
  const allHubs = new Set([...Object.keys(lsLocale), ...Object.keys(lsAuto)])
  for (const hubId of allHubs) {
    if (!hubId) continue
    if (!dbLocale[hubId] || dbLocale[hubId] !== lsLocale[hubId] || dbAuto[hubId] !== !!lsAuto[hubId]) {
      // raccogli item overrides per questo hubId
      const items = {}
      for (const k in lsItems) {
        if (k.startsWith(hubId + ':')) items[k.substring(hubId.length + 1)] = lsItems[k]
      }
      toUpsert.push({
        user_id: user.id,
        hub_id: hubId,
        locale: lsLocale[hubId] || dbLocale[hubId] || '',
        auto_assigned: !!lsAuto[hubId],
        item_overrides: items,
        updated_at: new Date().toISOString(),
      })
    }
  }
  if (toUpsert.length > 0) {
    try {
      // Filtra entries con locale vuoto
      const valid = toUpsert.filter(r => r.locale)
      if (valid.length > 0) {
        await supabase.from('ts_invoice_assignments').upsert(valid, { onConflict: 'user_id,hub_id' })
        // Aggiorna mappe DB locali
        for (const r of valid) {
          dbLocale[r.hub_id] = r.locale
          if (r.auto_assigned) dbAuto[r.hub_id] = true
          for (const k in r.item_overrides) dbItems[r.hub_id + ':' + k] = r.item_overrides[k]
        }
      }
    } catch (e) { console.warn('[assignments] upsert migration:', e.message) }
  }

  // 5. Aggiorna LS con stato consolidato (DB + LS)
  writeLs(LS_LOCALE, dbLocale)
  writeLs(LS_AUTO, dbAuto)
  writeLs(LS_ITEMS, dbItems)

  return { localeMap: dbLocale, autoAssigned: dbAuto, itemMap: dbItems }
}

// Salva una singola assegnazione (locale + auto + items) per un hubId.
// Aggiorna sia DB che localStorage.
export async function saveAssignment(hubId, { locale, autoAssigned, itemOverrides }) {
  const { data: { user } } = await supabase.auth.getUser()
  // Aggiorna LS subito (UI reattiva)
  const lsLocale = readLs(LS_LOCALE)
  const lsAuto = readLs(LS_AUTO)
  const lsItems = readLs(LS_ITEMS)
  if (locale != null) lsLocale[hubId] = locale
  if (autoAssigned != null) {
    if (autoAssigned) lsAuto[hubId] = true
    else delete lsAuto[hubId]
  }
  if (itemOverrides != null) {
    // rimuovo precedenti per questo hub
    for (const k in lsItems) if (k.startsWith(hubId + ':')) delete lsItems[k]
    for (const k in itemOverrides) lsItems[hubId + ':' + k] = itemOverrides[k]
  }
  writeLs(LS_LOCALE, lsLocale)
  writeLs(LS_AUTO, lsAuto)
  writeLs(LS_ITEMS, lsItems)
  // Salva su DB
  if (user && (lsLocale[hubId] || itemOverrides)) {
    try {
      const itemsForHub = {}
      for (const k in lsItems) {
        if (k.startsWith(hubId + ':')) itemsForHub[k.substring(hubId.length + 1)] = lsItems[k]
      }
      await supabase.from('ts_invoice_assignments').upsert({
        user_id: user.id,
        hub_id: hubId,
        locale: lsLocale[hubId] || '',
        auto_assigned: !!lsAuto[hubId],
        item_overrides: itemsForHub,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,hub_id' })
    } catch (e) { console.warn('[assignments] save:', e.message) }
  }
  return { localeMap: lsLocale, autoAssigned: lsAuto, itemMap: lsItems }
}

// Rimuove assegnazione (locale=vuoto)
export async function removeAssignment(hubId) {
  const { data: { user } } = await supabase.auth.getUser()
  const lsLocale = readLs(LS_LOCALE)
  const lsAuto = readLs(LS_AUTO)
  const lsItems = readLs(LS_ITEMS)
  delete lsLocale[hubId]
  delete lsAuto[hubId]
  for (const k in lsItems) if (k.startsWith(hubId + ':')) delete lsItems[k]
  writeLs(LS_LOCALE, lsLocale)
  writeLs(LS_AUTO, lsAuto)
  writeLs(LS_ITEMS, lsItems)
  if (user) {
    try {
      await supabase.from('ts_invoice_assignments').delete().eq('user_id', user.id).eq('hub_id', hubId)
    } catch (e) { console.warn('[assignments] delete:', e.message) }
  }
  return { localeMap: lsLocale, autoAssigned: lsAuto, itemMap: lsItems }
}

function readLocal() {
  return { localeMap: readLs(LS_LOCALE), autoAssigned: readLs(LS_AUTO), itemMap: readLs(LS_ITEMS) }
}
function readLs(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}
function writeLs(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
  // Notifica altri tab/finestre
  try { window.dispatchEvent(new StorageEvent('storage', { key })) } catch {}
}
