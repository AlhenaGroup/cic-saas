
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CiC manda POST con il receipt nel body
  if (req.method !== 'POST') return res.status(200).end();

  try {
    const entity = req.headers['x-cn-operation'] || 'UNKNOWN';
    const body = req.body;

    console.log('[WEBHOOK]', entity, JSON.stringify(body).substring(0, 200));

    // Salva in Supabase nella tabella webhook_events
    const { error } = await supabase.from('webhook_events').insert({
      entity_type: entity,
      payload: body,
      salespoint_id: body?.idSalesPoint || body?.salesPoint?.id || null,
      document_date: body?.date || body?.closingDate || null,
      total: body?.totalPrice || body?.total || 0,
      received_at: new Date().toISOString()
    });

    if (error) console.error('[WEBHOOK DB ERROR]', error.message);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    return res.status(200).json({ ok: true }); // CiC riprova se risponde != 2xx
  }
}
