const FO_BASE = 'https://fo-services.cassanova.com';

async function foGet(sessionCookie, path) {
  const res = await fetch(FO_BASE + path, {
    headers: {
      'Cookie': sessionCookie,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'it',
      'Referer': 'https://fo.cassanova.com/',
      'User-Agent': 'Mozilla/5.0',
      'cn-datetime': new Date().toISOString()
    }
  });
  return res;
}

const SALESPOINTS = [
  { id: 21747, name: 'REMEMBEER' },
  { id: 22399, name: 'CASA DE AMICIS' }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, sessionCookie, invoiceId, spId } = req.body || {};

  if (!sessionCookie) {
    return res.status(400).json({ error: 'sessionCookie required', needsSession: true });
  }

  try {
    switch (action) {
      // Lista tutte le fatture da entrambi i salespoint
      case 'list': {
        const { limit = 100, start = 0 } = req.body;
        const allInvoices = [];

        for (const sp of SALESPOINTS) {
          try {
            const r = await foGet(sessionCookie, `/integration/agyo-wrapper/${sp.id}/e-invoices?limit=${limit}&start=${start}`);
            if (r.ok) {
              const d = await r.json();
              const records = (d.records || []).map(inv => ({
                ...inv,
                salespoint_id: sp.id,
                salespoint_name: sp.name
              }));
              allInvoices.push(...records);
            }
          } catch (e) { /* skip salespoint errors */ }
        }

        // Ordina per data decrescente
        allInvoices.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        return res.status(200).json({ invoices: allInvoices, total: allInvoices.length });
      }

      // Scarica XML di una fattura
      case 'xml': {
        if (!invoiceId || !spId) return res.status(400).json({ error: 'invoiceId e spId richiesti' });

        // Prova su entrambi i salespoint se spId non matcha
        const spsToTry = spId ? [spId] : SALESPOINTS.map(s => s.id);

        for (const sid of spsToTry) {
          try {
            const r = await foGet(sessionCookie, `/integration/agyo-wrapper/${sid}/e-invoices/${invoiceId}/xml`);
            if (r.ok) {
              const xml = await r.text();
              return res.status(200).json({ xml, spId: sid });
            }
          } catch (e) { continue; }
        }

        return res.status(503).json({ error: 'XML non disponibile al momento. Riprova tra qualche minuto.' });
      }

      default:
        return res.status(400).json({ error: 'action richiesta: list, xml' });
    }
  } catch (err) {
    console.error('[INVOICES]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
