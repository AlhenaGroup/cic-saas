const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';

async function sbQuery(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } };
  if (body) opts.body = JSON.stringify(body);
  if (method === 'GET') opts.headers['Prefer'] = '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (method === 'GET') return res.json();
  return res;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Coordinate locali (da rendere configurabili)
const LOCALE_COORDS = {
  'REMEMBEER': { lat: 44.8857895, lng: 7.3293777 },
  'CASA DE AMICIS': { lat: 44.8858039, lng: 7.3299022 }
};
const MAX_DISTANCE = 25; // metri (locali vicini sulla stessa piazza)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.body || req.query || {};

  try {
    switch (action) {
      // Verifica PIN e ritorna info dipendente + ultimo movimento
      case 'verify': {
        const { pin, locale } = req.body;
        if (!pin || !locale) return res.status(400).json({ error: 'pin e locale richiesti' });

        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,ruolo,locale,stato`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });

        const emp = emps[0];
        if (emp.stato !== 'Attivo') return res.status(403).json({ error: 'Dipendente non attivo' });

        // Ultimo movimento oggi
        const today = new Date().toISOString().split('T')[0];
        const last = await sbQuery(`attendance?employee_id=eq.${emp.id}&locale=eq.${encodeURIComponent(locale)}&timestamp=gte.${today}T00:00:00&order=timestamp.desc&limit=1`);
        const lastTipo = last?.[0]?.tipo || null;
        const suggestedTipo = lastTipo === 'entrata' ? 'uscita' : 'entrata';

        return res.status(200).json({ employee: emp, lastTipo, suggestedTipo, lastTimestamp: last?.[0]?.timestamp });
      }

      // Registra timbratura
      case 'timbra': {
        const { pin, locale, tipo, lat, lng } = req.body;
        if (!pin || !locale || !tipo) return res.status(400).json({ error: 'pin, locale e tipo richiesti' });

        // Verifica PIN
        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });
        const emp = emps[0];

        // Verifica GPS
        let distanza = null;
        const coords = LOCALE_COORDS[locale];
        if (coords && lat && lng) {
          distanza = Math.round(haversineDistance(lat, lng, coords.lat, coords.lng));
          if (distanza > MAX_DISTANCE) {
            return res.status(403).json({ error: `Troppo lontano dal locale (${distanza}m, max ${MAX_DISTANCE}m)`, distanza });
          }
        }

        // Rate limiting: max 1 timbra ogni 5 min
        const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
        const recent = await sbQuery(`attendance?employee_id=eq.${emp.id}&timestamp=gte.${fiveMinAgo}&limit=1`);
        if (recent?.length) {
          return res.status(429).json({ error: 'Attendi almeno 5 minuti tra una timbratura e l\'altra' });
        }

        // Salva
        const r = await sbQuery('attendance', 'POST', [{
          employee_id: emp.id, locale, tipo,
          timestamp: new Date().toISOString(),
          lat: lat || null, lng: lng || null, distanza_m: distanza
        }]);

        return res.status(201).json({ ok: true, nome: emp.nome, tipo, distanza, timestamp: new Date().toISOString() });
      }

      // Storico timbrature di oggi per un dipendente
      case 'history': {
        const { pin, locale } = req.body || req.query;
        if (!pin) return res.status(400).json({ error: 'pin richiesto' });

        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });

        const today = new Date().toISOString().split('T')[0];
        const records = await sbQuery(`attendance?employee_id=eq.${emps[0].id}&timestamp=gte.${today}T00:00:00&order=timestamp.desc&limit=20`);

        return res.status(200).json({ records: records || [] });
      }

      default:
        return res.status(400).json({ error: 'action richiesta: verify, timbra, history' });
    }
  } catch (err) {
    console.error('[ATTENDANCE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
