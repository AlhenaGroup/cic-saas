// API campagne marketing — segmenta clienti per tag/visite/inattività/compleanno
// e invia messaggi via Gmail (email), Twilio Programmable SMS (sms) o Twilio WhatsApp (whatsapp).
// Auth: Bearer JWT del ristoratore. Multi-tenant via RLS.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

const TW_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TW_WA_FROM = process.env.TWILIO_WHATSAPP_FROM || ''
const TW_SMS_FROM = process.env.TWILIO_SMS_FROM || ''
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

async function requireUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  return { user }
}

// ─── Targeting ────────────────────────────────────────────────────
async function buildAudience(user_id, locale, c) {
  // Carica clienti con tag
  let q = sb.from('customers').select('*, customer_tags(tag_id)')
    .eq('user_id', user_id).eq('locale', locale)
  if (c.rispetta_gdpr) q = q.eq('gdpr_marketing', true)
  if (Number(c.segment_min_visite || 0) > 0) {
    // approssimazione: count visite via fidelity_movements / reservations completed
    // qui filtriamo dopo (segment_min_visite > 0 require post-fetch with movements)
  }
  if (c.segment_giorni_inattivita) {
    const cut = new Date(Date.now() - Number(c.segment_giorni_inattivita) * 86400000).toISOString()
    q = q.lt('last_seen_at', cut)
  }
  const { data, error } = await q
  if (error) throw error
  let list = data || []

  if (c.segment_solo_compleanno_mese) {
    const m = new Date().getMonth() + 1
    list = list.filter(c2 => c2.data_nascita && (new Date(c2.data_nascita).getMonth() + 1) === m)
  }

  // tag filter
  const wanted = c.segment_tag_ids || []
  if (wanted.length > 0) {
    const mode = c.segment_tag_mode || 'any'
    list = list.filter(cu => {
      const ids = (cu.customer_tags || []).map(t => t.tag_id)
      if (mode === 'all') return wanted.every(w => ids.includes(w))
      return wanted.some(w => ids.includes(w))
    })
  }

  // Filtra per canale (deve avere email o telefono)
  if (c.canale === 'email') list = list.filter(cu => cu.email)
  else                       list = list.filter(cu => cu.telefono)

  return list
}

function applyPlaceholders(tpl, customer, ctx = {}) {
  const out = String(tpl || '')
    .replace(/\{nome\}/g, customer.nome || '')
    .replace(/\{cognome\}/g, customer.cognome || '')
    .replace(/\{locale\}/g, ctx.locale || '')
    .replace(/\{punti\}/g, ctx.punti != null ? String(ctx.punti) : '')
  return out
}

// ─── Senders ────────────────────────────────────────────────────────
async function sendTwilioSms(to, body) {
  if (!TW_SID || !TW_TOKEN || !TW_SMS_FROM) return { error: 'Twilio SMS non configurato' }
  const params = new URLSearchParams({ From: TW_SMS_FROM, To: to, Body: body })
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.message || 'send failed' }
  return { sid: j.sid }
}

async function sendTwilioWhatsApp(to, body) {
  if (!TW_SID || !TW_TOKEN || !TW_WA_FROM) return { error: 'Twilio WhatsApp non configurato' }
  const tw = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
  const params = new URLSearchParams({ From: TW_WA_FROM, To: tw, Body: body })
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.message || 'send failed' }
  return { sid: j.sid }
}

async function refreshGoogleToken(refreshToken) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth non configurato')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!r.ok) throw new Error('refresh_token failed')
  return (await r.json()).access_token
}

async function sendGmail(accessToken, fromEmail, toEmail, subject, body) {
  // Body è plain text; convertiamo in HTML semplice mantenendo i newline.
  const html = String(body || '').replace(/\n/g, '<br>')
  const raw = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject || '').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n')
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.error?.message || 'gmail failed' }
  return { sid: j.id }
}

async function getGmailAccessToken(user_id) {
  const { data: tk } = await sb.from('google_tokens')
    .select('access_token, refresh_token, token_expiry, email')
    .eq('user_id', user_id).maybeSingle()
  if (!tk) return null
  if (tk.token_expiry && new Date(tk.token_expiry) > new Date(Date.now() + 60000)) {
    return { token: tk.access_token, email: tk.email }
  }
  if (!tk.refresh_token) return null
  const newToken = await refreshGoogleToken(tk.refresh_token)
  return { token: newToken, email: tk.email }
}

// ─── Send loop ──────────────────────────────────────────────────────
async function sendCampaign(user_id, campaign) {
  const audience = await buildAudience(user_id, campaign.locale, campaign)

  // marca sending + totale
  await sb.from('campaigns').update({
    stato: 'sending',
    destinatari_totali: audience.length,
    updated_at: new Date().toISOString(),
  }).eq('id', campaign.id)

  let inviati = 0, falliti = 0
  let gmail = null
  if (campaign.canale === 'email') {
    try { gmail = await getGmailAccessToken(user_id) } catch (e) { /* gestito sotto */ }
  }

  for (const cust of audience) {
    const dest = campaign.canale === 'email' ? cust.email : cust.telefono
    const body = applyPlaceholders(campaign.contenuto, cust, { locale: campaign.locale })
    const subj = campaign.canale === 'email' ? applyPlaceholders(campaign.oggetto || '', cust, { locale: campaign.locale }) : null

    let r
    try {
      if (campaign.canale === 'email') {
        if (!gmail) { r = { error: 'Gmail non connesso' } }
        else        { r = await sendGmail(gmail.token, gmail.email, dest, subj, body) }
      } else if (campaign.canale === 'sms') {
        r = await sendTwilioSms(dest, body)
      } else if (campaign.canale === 'whatsapp') {
        r = await sendTwilioWhatsApp(dest, body)
      } else {
        r = { error: 'canale invalido' }
      }
    } catch (e) {
      r = { error: e.message || String(e) }
    }

    const ok = !r.error
    await sb.from('campaign_messages').insert({
      campaign_id: campaign.id,
      user_id,
      customer_id: cust.id,
      destinatario: dest,
      contenuto_finale: body,
      oggetto_finale: subj,
      stato: ok ? 'sent' : 'failed',
      provider_sid: r.sid || null,
      errore: r.error || null,
      inviato_at: ok ? new Date().toISOString() : null,
      errore_at: ok ? null : new Date().toISOString(),
    })
    if (ok) inviati++; else falliti++
  }

  await sb.from('campaigns').update({
    stato: falliti === audience.length && audience.length > 0 ? 'failed' : 'sent',
    inviati,
    falliti,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', campaign.id)

  return { inviati, falliti, totale: audience.length }
}

// ─── Handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await requireUser(req)
  if (auth.error) return res.status(401).json({ error: auth.error })
  const user_id = auth.user.id

  const action = (req.body && req.body.action) || req.query.action
  const body = req.body || {}

  try {
    switch (action) {

      case 'list': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        const { data, error } = await sb.from('campaigns').select('*')
          .eq('user_id', user_id).eq('locale', locale)
          .order('created_at', { ascending: false })
        if (error) throw error
        return res.status(200).json({ campaigns: data || [] })
      }

      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data: camp, error } = await sb.from('campaigns').select('*')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        const { data: msgs } = await sb.from('campaign_messages')
          .select('*, customers(id, nome, cognome)')
          .eq('campaign_id', id).order('created_at', { ascending: false }).limit(200)
        return res.status(200).json({ campaign: camp, messages: msgs || [] })
      }

      case 'preview-audience': {
        const c = body.campaign || {}
        if (!c.locale) return res.status(400).json({ error: 'locale required' })
        const list = await buildAudience(user_id, c.locale, c)
        return res.status(200).json({ count: list.length, sample: list.slice(0, 8).map(c => ({
          id: c.id, nome: c.nome, cognome: c.cognome, telefono: c.telefono, email: c.email,
        })) })
      }

      case 'upsert': {
        const c = body.campaign || {}
        if (!c.locale || !c.nome || !c.canale || !c.contenuto) return res.status(400).json({ error: 'locale, nome, canale, contenuto required' })
        if (!['email', 'sms', 'whatsapp'].includes(c.canale)) return res.status(400).json({ error: 'canale invalido' })
        const payload = {
          user_id,
          locale: c.locale,
          nome: c.nome.trim(),
          canale: c.canale,
          oggetto: c.oggetto ?? null,
          contenuto: c.contenuto,
          segment_tag_ids: Array.isArray(c.segment_tag_ids) ? c.segment_tag_ids : [],
          segment_tag_mode: c.segment_tag_mode || 'any',
          segment_min_visite: Number(c.segment_min_visite || 0),
          segment_giorni_inattivita: c.segment_giorni_inattivita == null || c.segment_giorni_inattivita === '' ? null : Number(c.segment_giorni_inattivita),
          segment_solo_compleanno_mese: !!c.segment_solo_compleanno_mese,
          schedule_at: c.schedule_at || null,
          stato: c.stato || (c.schedule_at ? 'scheduled' : 'draft'),
          rispetta_gdpr: c.rispetta_gdpr !== false,
          updated_at: new Date().toISOString(),
        }
        if (c.id) {
          const { data, error } = await sb.from('campaigns').update(payload)
            .eq('user_id', user_id).eq('id', c.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ campaign: data })
        }
        const { data, error } = await sb.from('campaigns').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ campaign: data })
      }

      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('campaigns').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'send-now': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data: camp } = await sb.from('campaigns').select('*').eq('user_id', user_id).eq('id', id).maybeSingle()
        if (!camp) return res.status(404).json({ error: 'campaign non trovata' })
        if (['sending', 'sent'].includes(camp.stato)) return res.status(409).json({ error: 'campaign già inviata o in invio' })
        const result = await sendCampaign(user_id, camp)
        return res.status(200).json(result)
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
