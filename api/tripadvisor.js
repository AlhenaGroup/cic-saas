// TripAdvisor scraper
//
// Estrae rating, numero recensioni e ultime recensioni da una pagina pubblica
// TripAdvisor leggendo il blocco JSON-LD (schema.org/Restaurant) che la piattaforma
// include per la SEO. Questo approccio è più stabile del parsing HTML perché
// TripAdvisor aggiorna spesso le classi CSS ma il JSON-LD cambia raramente.
//
// Limiti noti:
// - TripAdvisor può restituire 403 se rileva bot da IP datacenter (Vercel).
//   In caso di errore l'endpoint risponde con {error, blocked: true}.
// - Il numero di recensioni testuali nel JSON-LD è limitato (di solito 1-5).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function extractJsonLd(html) {
  const out = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) out.push(...parsed)
      else out.push(parsed)
    } catch {}
  }
  return out
}

function findBusiness(ldBlocks) {
  // Cerca Restaurant / LocalBusiness / Organization (ordine di preferenza)
  const types = ['Restaurant', 'LocalBusiness', 'FoodEstablishment', 'BarOrPub', 'CafeOrCoffeeShop', 'Organization']
  for (const t of types) {
    const found = ldBlocks.find(b => {
      const type = Array.isArray(b['@type']) ? b['@type'][0] : b['@type']
      return type === t
    })
    if (found) return found
  }
  return ldBlocks.find(b => b.aggregateRating) || null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url } = req.body || {}
  if (!url || !/^https?:\/\/(www\.)?tripadvisor\./i.test(url)) {
    return res.status(400).json({ error: 'URL TripAdvisor richiesto' })
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache'
      }
    })
    if (!r.ok) {
      const blocked = r.status === 403 || r.status === 429
      return res.status(200).json({
        error: 'HTTP ' + r.status,
        blocked,
        message: blocked
          ? 'TripAdvisor ha bloccato la richiesta dal nostro server (anti-bot). Questo è frequente su Vercel. Soluzione: aprire la pagina manualmente per verificare i dati.'
          : 'Errore ' + r.status
      })
    }
    const html = await r.text()
    const blocks = extractJsonLd(html)
    if (blocks.length === 0) {
      return res.status(200).json({
        error: 'Nessun blocco JSON-LD trovato nella pagina',
        message: 'TripAdvisor ha cambiato la struttura della pagina'
      })
    }
    const biz = findBusiness(blocks)
    if (!biz) {
      return res.status(200).json({
        error: 'Nessun business schema trovato',
        raw: blocks.length + ' blocks'
      })
    }

    const agg = biz.aggregateRating || {}
    const reviews = (biz.review || []).map(rv => ({
      rating: Number(rv.reviewRating?.ratingValue || 0),
      text: rv.reviewBody || rv.description || '',
      authorName: rv.author?.name || (typeof rv.author === 'string' ? rv.author : null),
      datePublished: rv.datePublished || null
    }))

    return res.status(200).json({
      name: biz.name || null,
      url: biz.url || url,
      rating: Number(agg.ratingValue || 0) || null,
      reviewCount: Number(agg.reviewCount || 0) || null,
      bestRating: Number(agg.bestRating || 5),
      worstRating: Number(agg.worstRating || 1),
      priceRange: biz.priceRange || null,
      address: biz.address?.streetAddress || null,
      reviews,
      // Raw flag utile per il debug
      schemaType: Array.isArray(biz['@type']) ? biz['@type'][0] : biz['@type']
    })
  } catch (err) {
    console.error('[tripadvisor scraper]', err.message)
    return res.status(500).json({ error: err.message })
  }
}
