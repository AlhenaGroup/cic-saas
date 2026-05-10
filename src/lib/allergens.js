// ─── Allergeni: catalogo + auto-detect + aggregazione ricorsiva ──────
// Catalogo Reg. UE 1169/2011 (14 allergeni).
//
// Pipeline:
//   1) Articolo magazzino -> lookup in `article_allergens` (mappa configurata)
//   2) Se non trovato e l'articolo e' un semilavorato -> ricorri sui suoi ingredienti
//   3) Fallback: keyword matching dal nome (detectAllergeni)
//
// Exports:
//   ALLERGENI                  catalogo costante
//   ALLERGENI_BY_KEY           mappa key -> {l, ico}
//   detectAllergeni(nome)      fallback keyword (gia' usato in ProductionManager)
//   aggregateAllergens(...)    unione ricorsiva per array di ingredienti
//   loadAllergensMap(supabase) fetcha article_allergens dell'utente

import { supabase } from './supabase'

export const ALLERGENI = [
  { v: 'glutine',         l: 'Glutine' },
  { v: 'crostacei',       l: 'Crostacei' },
  { v: 'uova',            l: 'Uova' },
  { v: 'pesce',           l: 'Pesce' },
  { v: 'arachidi',        l: 'Arachidi' },
  { v: 'soia',            l: 'Soia' },
  { v: 'latte',           l: 'Latte' },
  { v: 'frutta_a_guscio', l: 'Frutta a guscio' },
  { v: 'sedano',          l: 'Sedano' },
  { v: 'senape',          l: 'Senape' },
  { v: 'sesamo',          l: 'Sesamo' },
  { v: 'solfiti',         l: 'Solfiti' },
  { v: 'lupini',          l: 'Lupini' },
  { v: 'molluschi',       l: 'Molluschi' },
]
export const ALLERGENI_BY_KEY = Object.fromEntries(ALLERGENI.map(a => [a.v, a]))

const ALLERGEN_KEYWORDS = {
  glutine:         ['farina', 'pane', 'pasta', 'pizza', 'focaccia', 'biscotto', 'frumento', 'orzo', 'segale', 'avena', 'farro', 'kamut', 'cracker', 'piadina', 'crackers', 'grissini', 'taralli', 'cous cous', 'couscous', 'bulgur', 'seitan'],
  crostacei:       ['gambero', 'gamberetto', 'aragosta', 'astice', 'granchio', 'scampo', 'mazzancolla', 'mazzancolle'],
  uova:            ['uovo', 'uova', 'albume', 'tuorlo', 'maionese', 'frittata', 'omelette', 'meringa'],
  pesce:           ['pesce', 'tonno', 'salmone', 'merluzzo', 'spigola', 'orata', 'branzino', 'acciuga', 'acciughe', 'sardina', 'sgombro', 'baccalà', 'stoccafisso', 'pesce spada', 'sardine'],
  arachidi:        ['arachidi', 'arachide', 'noccioline', 'peanut'],
  soia:            ['soia', 'tofu', 'edamame', 'tempeh', 'salsa di soia', 'tamari'],
  latte:           ['latte', 'burro', 'panna', 'formaggio', 'mozzarella', 'parmigiano', 'pecorino', 'ricotta', 'yogurt', 'mascarpone', 'gorgonzola', 'crescenza', 'stracchino', 'taleggio', 'caciotta', 'caciocavallo', 'fontina', 'asiago', 'grana', 'provolone', 'scamorza', 'caprino', 'bufala', 'gelato', 'panna acida'],
  frutta_a_guscio: ['noce', 'noci', 'nocciola', 'nocciole', 'mandorla', 'mandorle', 'pistacchio', 'pistacchi', 'anacardio', 'anacardi', 'pinolo', 'pinoli', 'castagna', 'castagne', 'pecan'],
  sedano:          ['sedano'],
  senape:          ['senape', 'mostarda'],
  sesamo:          ['sesamo', 'tahini', 'tahin'],
  solfiti:         ['vino', 'aceto', 'frutta secca', 'uvetta', 'sciroppo', 'birra', 'liquore', 'champagne', 'spumante', 'prosecco'],
  lupini:          ['lupini', 'lupino'],
  molluschi:       ['cozza', 'cozze', 'vongola', 'vongole', 'ostrica', 'ostriche', 'calamaro', 'calamari', 'seppia', 'seppie', 'polpo', 'polipo', 'lumache', 'chiocciole'],
}

export function detectAllergeni(nome) {
  if (!nome) return []
  const n = String(nome).toLowerCase()
  const found = []
  for (const [key, kws] of Object.entries(ALLERGEN_KEYWORDS)) {
    if (kws.some(k => n.includes(k))) found.push(key)
  }
  return found
}

// Carica la mappa allergens configurata: { nome_articolo_lower: ['glutine', ...] }
export async function loadAllergensMap() {
  const { data } = await supabase.from('article_allergens').select('nome_articolo, allergeni')
  const m = {}
  for (const r of (data || [])) {
    const k = (r.nome_articolo || '').trim().toLowerCase()
    m[k] = Array.isArray(r.allergeni) ? r.allergeni : []
  }
  return m
}

// Aggrega allergeni di un array di ingredienti. Per ogni ingrediente:
//   1) ignora se gratis
//   2) lookup in `allergMap`
//   3) se e' semilavorato -> ricorri (max 8 livelli per evitare loop)
//   4) fallback: detect dal nome (regex keyword)
export function aggregateAllergens(ingredienti, allergMap = {}, manualByName = {}, depth = 0) {
  if (depth > 8 || !Array.isArray(ingredienti)) return []
  const out = new Set()
  for (const ing of ingredienti) {
    if (!ing || ing.gratis) continue
    const nome = ing.nome_articolo || ''
    const key = nome.trim().toLowerCase()
    if (!key) continue

    // 1) Mappa configurata
    const configured = allergMap[key]
    if (configured && configured.length >= 0) {
      // anche array vuoto e' una scelta esplicita: niente allergeni configurati,
      // ma proviamo comunque il fallback regex per copertura
      configured.forEach(a => out.add(a))
      if (configured.length > 0) continue  // se gia' qualcosa e' stato configurato, basta
    }

    // 2) Semilavorato -> ricorri
    if (manualByName[key]) {
      const sub = aggregateAllergens(manualByName[key].ingredienti || [], allergMap, manualByName, depth + 1)
      sub.forEach(a => out.add(a))
      continue
    }

    // 3) Fallback regex keyword
    detectAllergeni(nome).forEach(a => out.add(a))
  }
  return [...out]
}

// Salva (upsert) gli allergeni di un articolo
export async function saveArticleAllergens(nome_articolo, allergeni, source = 'manual') {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Utente non autenticato')
  // upsert: se esiste, aggiorna; altrimenti inserisce
  const { error } = await supabase.from('article_allergens').upsert({
    user_id: user.id,
    nome_articolo: nome_articolo.trim(),
    allergeni: allergeni || [],
    source,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,nome_articolo' })
  if (error) throw error
}
