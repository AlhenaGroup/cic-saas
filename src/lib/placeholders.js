// Articoli placeholder ("in attesa di fattura"): nomi liberi creati direttamente
// nelle ricette / semilavorati prima che esista una fattura. Quando arriva una
// fattura con descrizione che matcha (via item_rules) il prezzo_medio reale
// sostituisce automaticamente prezzo_stimato e l'articolo viene "agganciato".
//
// Tabella: placeholder_articles
// Match con articoli reali via nome_norm (lowercase + trim + collapse spaces).

import { supabase } from './supabase'

// Normalizza nome per match case-insensitive e spazi
export function normalizeName(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

// Lista tutti i placeholder dell'utente
export async function listPlaceholders() {
  const { data, error } = await supabase
    .from('placeholder_articles')
    .select('*')
    .order('nome')
  if (error) throw error
  return data || []
}

// Crea (o restituisce esistente con stesso nome_norm)
export async function createPlaceholder({ nome, unita = 'PZ', prezzo_stimato = null, magazzino = null, locale = null, note = null }) {
  if (!nome || !String(nome).trim()) throw new Error('nome obbligatorio')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('non autenticato')

  const nome_norm = normalizeName(nome)
  // Cerca esistente con stesso nome_norm (UNIQUE su user_id+nome_norm)
  const { data: existing } = await supabase
    .from('placeholder_articles')
    .select('*')
    .eq('user_id', user.id)
    .eq('nome_norm', nome_norm)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabase
    .from('placeholder_articles')
    .insert({
      user_id: user.id,
      nome: String(nome).trim(),
      nome_norm,
      unita: unita || 'PZ',
      prezzo_stimato: prezzo_stimato == null || prezzo_stimato === '' ? null : Number(prezzo_stimato),
      magazzino: magazzino || null,
      locale: locale || null,
      note: note || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Aggiorna placeholder
export async function updatePlaceholder(id, patch) {
  const cleaned = { ...patch, updated_at: new Date().toISOString() }
  if ('nome' in cleaned && cleaned.nome) cleaned.nome_norm = normalizeName(cleaned.nome)
  const { error } = await supabase.from('placeholder_articles').update(cleaned).eq('id', id)
  if (error) throw error
}

// Elimina placeholder
export async function deletePlaceholder(id) {
  const { error } = await supabase.from('placeholder_articles').delete().eq('id', id)
  if (error) throw error
}

// Aggancia un placeholder a un articolo reale di fattura. agganciato_a = nome canonico
export async function agganciaPlaceholder(id, agganciato_a) {
  const { error } = await supabase.from('placeholder_articles').update({
    agganciato_a,
    agganciato_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
}

// Auto-match: dato un nome_articolo (es. dalla nuova item_rule appena salvata),
// se esiste un placeholder con stesso nome_norm e non ancora agganciato, aggancialo.
// Restituisce il placeholder agganciato (se trovato) o null.
export async function tryAutoLink(nome_articolo) {
  if (!nome_articolo) return null
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const nome_norm = normalizeName(nome_articolo)
  const { data: ph } = await supabase
    .from('placeholder_articles')
    .select('*')
    .eq('user_id', user.id)
    .eq('nome_norm', nome_norm)
    .is('agganciato_a', null)
    .maybeSingle()
  if (!ph) return null
  await agganciaPlaceholder(ph.id, nome_articolo)
  return { ...ph, agganciato_a: nome_articolo }
}

// Trova placeholder per nome (case-insensitive). Usato dal calcolo food cost
// come fallback se l'articolo non e' in fatture.
export function findPlaceholderByName(placeholders, nome) {
  const norm = normalizeName(nome)
  return (placeholders || []).find(p => p.nome_norm === norm)
}
