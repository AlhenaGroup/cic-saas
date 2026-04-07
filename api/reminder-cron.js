const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';

async function sbQuery(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (method === 'GET') return res.json();
  return res.status;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const logs = [];
  let created = 0;

  try {
    const today = new Date();
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);

    // Fetch documents with upcoming expiry
    const docs = await sbQuery(`employee_documents?scadenza=not.is.null&scadenza=gte.${today.toISOString().split('T')[0]}&scadenza=lte.${in30.toISOString().split('T')[0]}&select=id,nome,scadenza,employee_id,user_id`);

    if (!docs?.length) {
      logs.push('Nessun documento in scadenza nei prossimi 30 giorni');
      return res.status(200).json({ ok: true, created: 0, logs });
    }

    // Fetch existing calendar events for these documents
    const existingEvents = await sbQuery(`calendar_events?tipo=eq.scadenza_doc&select=document_id`);
    const existingDocIds = new Set((existingEvents || []).map(e => e.document_id));

    for (const doc of docs) {
      if (existingDocIds.has(doc.id)) continue;

      const scad = new Date(doc.scadenza);
      const daysUntil = Math.round((scad - today) / 86400000);
      const urgenza = daysUntil <= 5 ? 'critica' : daysUntil <= 15 ? 'alta' : 'normale';

      // Create calendar event
      const status = await sbQuery('calendar_events', 'POST', [{
        user_id: doc.user_id,
        titolo: 'Scadenza: ' + doc.nome,
        descrizione: `Documento in scadenza tra ${daysUntil} giorni`,
        data_inizio: doc.scadenza + 'T09:00:00+00:00',
        data_fine: doc.scadenza + 'T09:00:00+00:00',
        tipo: 'scadenza_doc',
        urgenza: urgenza,
        employee_id: doc.employee_id,
        document_id: doc.id,
        reminder_days: [30, 15, 5]
      }]);

      if (status === 201) {
        created++;
        logs.push(`Creato reminder per "${doc.nome}" (scade tra ${daysUntil}gg)`);
      }
    }
  } catch (e) {
    logs.push('Errore: ' + e.message);
    return res.status(500).json({ error: e.message, logs });
  }

  return res.status(200).json({ ok: true, created, logs, at: new Date().toISOString() });
}
