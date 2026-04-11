// Proxy per Plateform CRM API
// Endpoint: POST /crm/getCustomerList (form-urlencoded)
// Auth: Authorization: Bearer <token> dove token è il valore del cookie "user-panel"
//       del pannello admin.plateform.app
//
// Il proxy evita il problema CORS (il browser non può chiamare plateform.app direttamente
// con Authorization custom) e permette alla dashboard di sincronizzare in diretta.

const PF_BASE = 'https://admin.plateform.app/backend/api/vue2';

function buildCustomerListBody(locationID, visitMin, visitMax, page) {
  // Replica esatta del body che manda l'UI plateform.app (ricerca avanzata → Cerca)
  const must = [];
  if (typeof visitMin === 'number' && typeof visitMax === 'number') {
    must.push({ range: { visit: { gte: String(visitMin), lte: String(visitMax) } } });
  } else if (typeof visitMin === 'number') {
    must.push({ range: { visit: { gte: String(visitMin) } } });
  }
  if (locationID) must.push({ match: { locationID: Number(locationID) } });

  const query = {
    query: { bool: { must: must.length ? must : [{ match_all: {} }] } },
    sort: [
      { lastSeen: { order: 'desc' } },
      { lastUpdate: { order: 'desc' } },
      { _score: { order: 'desc' } }
    ]
  };
  const params = new URLSearchParams();
  params.append('query', JSON.stringify(query));
  params.append('page', String(page || 1));
  return params.toString();
}

async function pfPost(token, path, body) {
  const res = await fetch(PF_BASE + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'it',
      'User-Agent': 'CIC-Dashboard/1.0'
    },
    body
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('PF ' + res.status + ': invalid JSON — ' + text.substring(0, 200)); }
  if (!res.ok) throw new Error('PF ' + res.status + ': ' + (data.message || text.substring(0, 200)));
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token, locationID, page = 1, visitMin, visitMax } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required (Plateform user-panel cookie value)' });

  try {
    switch (action) {
      case 'test': {
        // Verifica rapida: usa quickSearch (sempre ritorna qualcosa se il token è valido)
        const d = await pfPost(token, '/crm/quickSearch', 'crmSearchString=');
        return res.status(200).json({
          ok: d.status === true,
          sample: (d.data?.list || []).slice(0, 1),
          message: d.message
        });
      }

      case 'get-segments': {
        // Lista segmenti salvati nel pannello Plateform (utili per filtri veloci)
        const d = await pfPost(token, '/crm/getSegmentList', '');
        return res.status(200).json({
          segments: (d.data || []).map(s => ({
            id: s.id,
            nome: s.nome,
            locationID: s.idTabellaStrutture
          }))
        });
      }

      case 'list-page': {
        // Fetch di UNA pagina di clienti (100 record per pagina)
        if (!locationID) return res.status(400).json({ error: 'locationID required' });
        const body = buildCustomerListBody(locationID, visitMin, visitMax, page);
        const d = await pfPost(token, '/crm/getCustomerList', body);
        return res.status(200).json({
          list: d.data?.list || [],
          totalRecords: d.data?.totalRecords || 0,
          maxPages: d.data?.maxPages || 1,
          currentPage: d.data?.currentPage || page
        });
      }

      case 'list-all': {
        // Fetch di TUTTI i clienti (itera tutte le pagine)
        // Limita a max 100 pagine per sicurezza (10.000 record max).
        if (!locationID) return res.status(400).json({ error: 'locationID required' });
        const all = [];
        let currentPage = 1;
        let maxPages = 1;
        let totalRecords = 0;
        do {
          const body = buildCustomerListBody(locationID, visitMin, visitMax, currentPage);
          const d = await pfPost(token, '/crm/getCustomerList', body);
          const list = d.data?.list || [];
          all.push(...list);
          maxPages = d.data?.maxPages || 1;
          totalRecords = d.data?.totalRecords || 0;
          if (!list.length) break;
          currentPage++;
        } while (currentPage <= maxPages && currentPage <= 100);
        return res.status(200).json({
          list: all,
          totalRecords,
          pagesFetched: currentPage - 1,
          maxPages
        });
      }

      default:
        return res.status(400).json({ error: 'unknown action: ' + action });
    }
  } catch (err) {
    console.error('[PLATEFORM PROXY]', action, err.message);
    return res.status(500).json({ error: err.message });
  }
}
