import { createContext, useContext } from 'react'

// Catalogo permessi e helper per l'accesso multi-utente alla dashboard.
//
// Modello permessi: dot-flat su `employees.module_permissions` (JSONB).
// Esempio:
//   { "mag": "rw", "mag.fatture": "r", "hr.dip": "rw", "ov": "r" }
//
// Risoluzione (coerente con la funzione SQL `public.can_access`):
//   1. se esiste chiave `module.subtab` -> usa quel valore
//   2. else se esiste chiave `module`   -> vale per tutti i sub-tab del modulo
//   3. else                              -> nessun accesso
//
// Valori: "rw" = read+write, "r" = sola lettura, null/assente = no access.

// Catalogo top-level moduli (chiave -> label, ordine UI)
export const MODULES = [
  ['ov', 'Panoramica'],
  ['conta', 'Contabilità'],
  ['vendite', 'Vendite'],
  ['mag', 'Magazzino'],
  ['hr', 'HR'],
  ['mkt', 'Marketing'],
  ['avvisi', 'Avvisi'],
  ['imp', 'Impostazioni'],
]

// Catalogo sub-tab per modulo (chiave -> label).
// Le chiavi devono essere identiche a quelle usate nei vari Module.jsx.
export const SUB_TABS = {
  ov: [],
  conta: [
    ['fatture', 'Fatture'],
    ['ce', 'Conto Economico'],
    ['bud', 'Budget'],
    ['iva', 'IVA'],
    ['chiusure', 'Chiusure'],
  ],
  vendite: [
    ['scontrini', 'Scontrini'],
    ['cat', 'Categorie'],
    ['rep', 'Reparti'],
  ],
  mag: [
    ['cruscotto', 'Cruscotto'],
    ['fatture', 'Fatture'],
    ['prodotti', 'Prodotti'],
    ['articoli', 'Articoli'],
    ['semilavorati', 'Semilavorati'],
    ['ricette', 'Ricette'],
    ['produzione', 'Produzione'],
    ['giacenze', 'Giacenze'],
    ['movimenti', 'Movimenti'],
    ['inventario', 'Inventario'],
    ['ordini', 'Ordini'],
    ['prezzi', 'Prezzi'],
  ],
  hr: [
    ['prod', 'Produttività'],
    ['dip', 'Dipendenti'],
    ['doc', 'Documenti'],
    ['cal', 'Calendario'],
    ['task', 'Task'],
    ['presenze', 'Presenze'],
    ['turni', 'Turni'],
    ['checklist', 'Checklist'],
  ],
  mkt: [
    ['prenotaz', 'Prenotazioni'],
    ['clienti', 'Clienti'],
    ['automazioni', 'Automazioni'],
    ['campagne', 'Campagne'],
    ['promo', 'Promozioni'],
    ['fidelity', 'Fidelity'],
    ['sondaggi', 'Sondaggi'],
    ['reviews', 'Recensioni'],
    ['centralino', 'Centralino'],
  ],
  avvisi: [
    ['feed', 'Feed'],
    ['config', 'Configurazione'],
  ],
  imp: [
    ['generale', 'Generale'],
    ['integrazioni', 'Integrazioni'],
    ['notifiche', 'Notifiche'],
    ['account', 'Account'],
    // 'team' aggiunto come tab solo per owner (non un permesso assegnabile)
  ],
}

// Vero se la sessione e' di un dipendente staff (non owner).
export function isStaffSession(session) {
  return !!session?.user?.user_metadata?.staff
}

// Risolve il valore del permesso per `mod` o `mod.subtab`.
// `perms`: oggetto { "mod": "rw", "mod.subtab": "r", ... }
// Ritorna "rw" / "r" / null
function resolvePerm(perms, modKey) {
  if (!perms) return null
  if (Object.prototype.hasOwnProperty.call(perms, modKey)) return perms[modKey]
  // se modKey contiene un punto, fall back al modulo top-level
  const dot = modKey.indexOf('.')
  if (dot > 0) {
    const top = modKey.slice(0, dot)
    if (Object.prototype.hasOwnProperty.call(perms, top)) return perms[top]
  }
  return null
}

// Per il livello TOP (es. "mag"): se non trovo la chiave esatta, controllo se
// esiste almeno una sottochiave "mag.X" con valore non null. Cosi' il modulo
// appare nella nav anche se sono stati abilitati solo alcuni sub-tab.
// Ritorna il "miglior" valore tra le sottochiavi (rw vince su r) per gestire writeNeeded.
function bestSubPerm(perms, topKey) {
  if (!perms) return null
  const prefix = topKey + '.'
  let best = null // null < 'r' < 'rw'
  for (const k of Object.keys(perms)) {
    if (!k.startsWith(prefix)) continue
    const v = perms[k]
    if (v === 'rw') return 'rw'
    if (v === 'r' && best == null) best = 'r'
  }
  return best
}

// Ritorna true se `perms` permette l'accesso al `modKey` (es. "mag" o "mag.ricette").
// `needWrite=true` richiede "rw"; default false richiede almeno "r".
export function canAccess(perms, modKey, needWrite = false) {
  let v = resolvePerm(perms, modKey)
  // Se chiave top-level e non trovo valore, controllo se almeno un sub-tab e' abilitato
  if (v == null && !modKey.includes('.')) {
    v = bestSubPerm(perms, modKey)
  }
  if (v == null) return false
  if (needWrite) return v === 'rw'
  return v === 'r' || v === 'rw'
}

// Filtra una lista di [key, label] tenendo solo quelle accessibili.
export function filterAccessible(list, perms) {
  if (!perms) return list // owner: tutto
  return list.filter(([k]) => canAccess(perms, k, false))
}

// Per UI permessi: itera moduli e sub-tab.
// Ritorna [{ mod, label, subTabs: [{key, label}] }]
export function permissionMatrix() {
  return MODULES.map(([k, label]) => ({
    mod: k,
    label,
    subTabs: SUB_TABS[k] || [],
  }))
}

// Carica i permessi di uno staff dato l'auth_user_id (chiamare da DashboardPage).
// Usa il client supabase passato come argomento (per evitare import circolari).
export async function loadStaffEmployee(supabase) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('employees')
    .select('id, user_id, nome, email, ruolo, locale, stato, module_permissions')
    .eq('auth_user_id', user.id)
    .eq('stato', 'Attivo')
    .maybeSingle()
  if (error || !data) return null
  return data
}

// Context per i permessi: null = owner (full access). Oggetto perms = staff.
// I componenti consumatori usano `useStaffPerms()`. Se ritorna null l'utente
// e' l'owner e tutto e' permesso; se ritorna un oggetto e' uno staff e va
// filtrato di conseguenza.
const StaffPermsContext = createContext(null)
export const StaffPermsProvider = StaffPermsContext.Provider
export function useStaffPerms() { return useContext(StaffPermsContext) }
// Helper di convenienza: ritorna true se l'utente puo' accedere a modKey.
// Se non c'e' un Provider attivo ritorna sempre true (owner).
export function useCanAccess(modKey, needWrite = false) {
  const perms = useStaffPerms()
  if (!perms) return true
  return canAccess(perms, modKey, needWrite)
}
