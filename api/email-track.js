// Endpoint pubblico (no auth) per tracking email:
// - GET ?p=TOKEN  1×1 pixel GIF + marca aperto_at e aperture_count
// - GET ?l=TOKEN  302 redirect a URL originale + marca click_at e click_count
//
// I token sono opachi (uuid v4) e mappati nel DB.
// pixel: campaign_messages.pixel_token
// link:  campaign_messages.link_tokens jsonb { token: { url, click_count } }

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

// 1×1 transparent GIF (43 bytes)
const PIXEL_GIF = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')

  const p = req.query.p || null
  const l = req.query.l || null

  try {
    if (p) {
      // Pixel di apertura
      const { data: msg } = await sb.from('campaign_messages')
        .select('id, campaign_id, aperto_at, aperture_count')
        .eq('pixel_token', p).maybeSingle()
      if (msg) {
        const updates = {
          aperture_count: (msg.aperture_count || 0) + 1,
        }
        if (!msg.aperto_at) updates.aperto_at = new Date().toISOString()
        await sb.from('campaign_messages').update(updates).eq('id', msg.id)
        if (!msg.aperto_at) {
          // primo open: incrementa contatore campagna
          const { data: c } = await sb.from('campaigns').select('aperti').eq('id', msg.campaign_id).maybeSingle()
          await sb.from('campaigns').update({ aperti: (c?.aperti || 0) + 1 }).eq('id', msg.campaign_id)
        }
      }
      res.setHeader('Content-Type', 'image/gif')
      res.setHeader('Content-Length', PIXEL_GIF.length)
      return res.status(200).send(PIXEL_GIF)
    }

    if (l) {
      // Click su link.
      // Postgres jsonb @> con `{token: {}}` matcha qualsiasi oggetto che abbia quella chiave
      // (un oggetto vuoto è subset di qualsiasi oggetto). Supabase espone @> tramite .contains().
      const { data: rows } = await sb.from('campaign_messages')
        .select('id, campaign_id, click_at, click_count, link_tokens')
        .contains('link_tokens', { [l]: {} })
        .limit(1)
      let msg = (rows && rows[0]) || null
      if (!msg) {
        // Fallback raro: scansione limitata sugli invii recenti.
        const { data: candidates } = await sb.from('campaign_messages')
          .select('id, campaign_id, click_at, click_count, link_tokens')
          .not('link_tokens', 'is', null)
          .order('inviato_at', { ascending: false })
          .limit(500)
        msg = (candidates || []).find(m => m.link_tokens && m.link_tokens[l])
      }
      if (msg) {
        const tokens = msg.link_tokens || {}
        const target = tokens[l]?.url
        const updates = {
          click_count: (msg.click_count || 0) + 1,
          link_tokens: {
            ...tokens,
            [l]: { ...tokens[l], click_count: ((tokens[l]?.click_count) || 0) + 1 },
          },
        }
        if (!msg.click_at) updates.click_at = new Date().toISOString()
        await sb.from('campaign_messages').update(updates).eq('id', msg.id)
        if (!msg.click_at) {
          const { data: c } = await sb.from('campaigns').select('click').eq('id', msg.campaign_id).maybeSingle()
          await sb.from('campaigns').update({ click: (c?.click || 0) + 1 }).eq('id', msg.campaign_id)
        }
        if (target) {
          res.setHeader('Location', target)
          return res.status(302).end()
        }
      }
      // token non trovato redirect a homepage
      res.setHeader('Location', '/')
      return res.status(302).end()
    }

    return res.status(400).json({ error: 'missing token' })
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
