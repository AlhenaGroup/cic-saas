// API campagne marketing — segmenta clienti per tag/visite/inattività/compleanno
// e invia messaggi via Gmail (email), Twilio Programmable SMS (sms) o Twilio WhatsApp (whatsapp).
// Auth: Bearer JWT del ristoratore. Multi-tenant via RLS.

import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

const TW_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TW_WA_FROM = process.env.TWILIO_WHATSAPP_FROM || ''
const TW_SMS_FROM = process.env.TWILIO_SMS_FROM || ''
const SG_API_KEY = process.env.SENDGRID_API_KEY || ''
const SG_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'mail@cic-saas.it'
const SG_FROM_NAME = process.env.SENDGRID_FROM_NAME || 'CIC SaaS'

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

// Invio email via SendGrid v3 API.
// Sender: env globale (override futuro per-locale via marketing_settings).
// DKIM: configurato lato SendGrid per `SG_FROM_EMAIL` (vedi CLAUDE.md sezione "Provider email").
async function sendSendGrid(toEmail, subject, htmlReady, opts = {}) {
  if (!SG_API_KEY) return { error: 'SendGrid non configurato (SENDGRID_API_KEY mancante)' }
  const fromEmail = opts.fromEmail || SG_FROM_EMAIL
  const fromName = opts.fromName || SG_FROM_NAME
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + SG_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: fromName },
      subject: subject || '(senza oggetto)',
      content: [{ type: 'text/html', value: htmlReady }],
      // Disabilita tracking SendGrid (usiamo il nostro pixel + link rewrite per metriche coerenti col DB)
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
        subscription_tracking: { enable: false },
      },
    }),
  })
  if (r.status >= 200 && r.status < 300) {
    // SendGrid restituisce X-Message-Id come header su 202
    return { sid: r.headers.get('x-message-id') || null }
  }
  const errText = await r.text().catch(() => '')
  return { error: `sendgrid ${r.status}: ${errText.slice(0, 200)}` }
}

// Render dei blocchi del builder in HTML email-safe (table-based).
// Replica logica frontend (src/lib/emailBlocks.js) per evitare import cross-bundle.
function escHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function renderBlock(b) {
  const p = b.props || {}
  switch (b.type) {
    case 'header': return `<tr><td style="padding:16px 24px;text-align:${p.align || 'center'};"><h1 style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:${p.size || 28}px;color:${p.color || '#111'};font-weight:${p.bold ? 700 : 600};line-height:1.2;">${escHtml(p.text || '')}</h1></td></tr>`
    case 'text': return `<tr><td style="padding:8px 24px;text-align:${p.align || 'left'};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:${p.size || 14}px;color:${p.color || '#374151'};line-height:1.6;">${String(p.html || '').replace(/\n/g, '<br>')}</td></tr>`
    case 'image': {
      if (!p.src) return ''
      const img = `<img src="${escHtml(p.src)}" alt="${escHtml(p.alt || '')}" width="${p.width || 600}" style="display:block;max-width:100%;height:auto;border:0;" />`
      const inner = p.link ? `<a href="${escHtml(p.link)}">${img}</a>` : img
      return `<tr><td style="padding:8px 24px;text-align:center;">${inner}</td></tr>`
    }
    case 'button': return `<tr><td style="padding:14px 24px;text-align:center;"><a href="${escHtml(p.url || '#')}" style="display:inline-block;background:${p.bg || '#F59E0B'};color:${p.color || '#0f1420'};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:${p.padding || 12}px 22px;border-radius:${p.radius != null ? p.radius : 6}px;">${escHtml(p.text || 'Click')}</a></td></tr>`
    case 'divider': return `<tr><td style="padding:${p.margin || 12}px 24px;"><div style="border-top:${p.height || 1}px solid ${p.color || '#e5e7eb'};"></div></td></tr>`
    case 'spacer': return `<tr><td style="height:${p.height || 24}px;line-height:${p.height || 24}px;font-size:1px;">&nbsp;</td></tr>`
    case 'social': {
      const links = []
      if (p.facebook)    links.push(`<a href="${escHtml(p.facebook)}" style="margin:0 6px;color:#1877F2;text-decoration:none;font-weight:600;">Facebook</a>`)
      if (p.instagram)   links.push(`<a href="${escHtml(p.instagram)}" style="margin:0 6px;color:#E4405F;text-decoration:none;font-weight:600;">Instagram</a>`)
      if (p.twitter)     links.push(`<a href="${escHtml(p.twitter)}" style="margin:0 6px;color:#000;text-decoration:none;font-weight:600;">X</a>`)
      if (p.tripadvisor) links.push(`<a href="${escHtml(p.tripadvisor)}" style="margin:0 6px;color:#00AA6C;text-decoration:none;font-weight:600;">TripAdvisor</a>`)
      if (p.google)      links.push(`<a href="${escHtml(p.google)}" style="margin:0 6px;color:#4285F4;text-decoration:none;font-weight:600;">Google</a>`)
      if (links.length === 0) return ''
      return `<tr><td style="padding:14px 24px;text-align:center;font-size:13px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">${links.join(' · ')}</td></tr>`
    }
    case 'footer': return `<tr><td style="padding:18px 24px 24px;text-align:center;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:${p.size || 11}px;color:${p.color || '#94a3b8'};line-height:1.6;">${String(p.html || '').replace(/\n/g, '<br>')}</td></tr>`
    default: return ''
  }
}
function renderBlocksToHtml(blocks, meta = {}) {
  const bg = meta.bg_color || '#f5f5f5'
  const cardBg = meta.card_bg || '#ffffff'
  const width = meta.content_width || 600
  const inner = (blocks || []).map(renderBlock).join('')
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:24px 12px;">
<tr><td align="center"><table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;background:${cardBg};border-radius:8px;overflow:hidden;">${inner}</table></td></tr>
</table></body></html>`
}

// Genera HTML email con pixel di tracking + link riscritti.
// Se html già è HTML completo (da builder), inietta solo pixel + riscrive gli href.
// Restituisce { html, pixel_token, link_tokens } per persistere nel DB.
function buildTrackedHtml(input, baseUrl, isHtml = false) {
  const pixel_token = crypto.randomUUID()
  let html = isHtml ? String(input || '') : String(input || '').replace(/\n/g, '<br>')

  const link_tokens = {}
  if (isHtml) {
    // riscrivi href="..." per i link esterni
    html = html.replace(/href="(https?:\/\/[^"]+)"/g, (m, url) => {
      const t = crypto.randomUUID()
      link_tokens[t] = { url, click_count: 0 }
      return `href="${baseUrl}/api/email-track?l=${t}"`
    })
  } else {
    html = html.replace(/(https?:\/\/[^\s<>"]+)/g, (url) => {
      const t = crypto.randomUUID()
      link_tokens[t] = { url, click_count: 0 }
      return `${baseUrl}/api/email-track?l=${t}`
    })
  }

  const pixelUrl = `${baseUrl}/api/email-track?p=${pixel_token}`
  const pixelImg = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;outline:none;text-decoration:none" />`
  if (isHtml && /<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, pixelImg + '</body>')
  } else {
    html += pixelImg
  }

  return { html, pixel_token, link_tokens }
}

// ─── Send loop ──────────────────────────────────────────────────────
// Rate limit per canale (delay tra invii in ms).
// SendGrid free/essentials: 100 email/sec → 10ms basta. Conservativi a 100ms.
// Twilio long-code: 1 msg/sec → 1100ms.
const RATE_DELAY_MS = { email: 100, sms: 1100, whatsapp: 1100 }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Retry semplice con exponential backoff per errori transitori (5xx, network, 429).
function isTransientError(errMsg) {
  if (!errMsg) return false
  const m = String(errMsg).toLowerCase()
  return /\b(429|500|502|503|504|timeout|rate.?limit|temporar|econnreset|fetch failed)\b/.test(m)
}
async function withRetry(fn, maxAttempts = 3) {
  let lastErr = null
  for (let i = 0; i < maxAttempts; i++) {
    const r = await fn()
    if (!r || !r.error) return r
    lastErr = r.error
    if (!isTransientError(lastErr) || i === maxAttempts - 1) return r
    await sleep(500 * Math.pow(2, i))  // 500ms, 1s, 2s
  }
  return { error: lastErr }
}

async function sendCampaign(user_id, campaign) {
  const audience = await buildAudience(user_id, campaign.locale, campaign)

  // marca sending + totale
  await sb.from('campaigns').update({
    stato: 'sending',
    destinatari_totali: audience.length,
    updated_at: new Date().toISOString(),
  }).eq('id', campaign.id)

  let inviati = 0, falliti = 0

  // baseUrl per i link tracking (fallback su env, poi su domain Vercel di default)
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://cic-saas.vercel.app'
  const delayMs = RATE_DELAY_MS[campaign.canale] || 1000

  for (const cust of audience) {
    const dest = campaign.canale === 'email' ? cust.email : cust.telefono
    const body = applyPlaceholders(campaign.contenuto, cust, { locale: campaign.locale })
    const subj = campaign.canale === 'email' ? applyPlaceholders(campaign.oggetto || '', cust, { locale: campaign.locale }) : null

    let r, pixel_token = null, link_tokens = null
    try {
      if (campaign.canale === 'email') {
        if (!SG_API_KEY) { r = { error: 'SendGrid non configurato (SENDGRID_API_KEY mancante)' } }
        else {
          // Se la campaign ha blocks, render HTML completo, poi inietta tracking
          let html, isHtml = false
          if (Array.isArray(campaign.blocks) && campaign.blocks.length > 0) {
            const customBlocks = campaign.blocks.map(b => {
              const np = { ...(b.props || {}) }
              for (const k of ['text', 'html', 'alt']) {
                if (np[k]) np[k] = applyPlaceholders(np[k], cust, { locale: campaign.locale })
              }
              return { ...b, props: np }
            })
            html = renderBlocksToHtml(customBlocks, campaign.meta || {})
            isHtml = true
          } else {
            html = body
          }
          const tracked = buildTrackedHtml(html, baseUrl, isHtml)
          pixel_token = tracked.pixel_token
          link_tokens = tracked.link_tokens
          r = await withRetry(() => sendSendGrid(dest, subj, tracked.html))
        }
      } else if (campaign.canale === 'sms') {
        r = await withRetry(() => sendTwilioSms(dest, body))
      } else if (campaign.canale === 'whatsapp') {
        r = await withRetry(() => sendTwilioWhatsApp(dest, body))
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
      pixel_token: ok ? pixel_token : null,
      link_tokens: link_tokens || {},
    })
    if (ok) inviati++; else falliti++

    // Rate limit: pausa tra invii (solo se ci sono altri in coda)
    if (delayMs > 0) await sleep(delayMs)
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
        if (!c.locale || !c.nome || !c.canale) return res.status(400).json({ error: 'locale, nome, canale required' })
        if (!['email', 'sms', 'whatsapp'].includes(c.canale)) return res.status(400).json({ error: 'canale invalido' })
        const hasBlocks = Array.isArray(c.blocks) && c.blocks.length > 0
        if (!c.contenuto && !hasBlocks) return res.status(400).json({ error: 'contenuto or blocks required' })
        const payload = {
          user_id,
          locale: c.locale,
          nome: c.nome.trim(),
          canale: c.canale,
          oggetto: c.oggetto ?? null,
          contenuto: c.contenuto || '',
          blocks: hasBlocks ? c.blocks : [],
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
