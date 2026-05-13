// Webhook 3CX per il centralino.
// 3CX (PBX usato da Alhena, fornito da Plateform via DECT base station) chiama questo endpoint
// quando una chiamata entrante arriva su un numero configurato.
//
// SETUP 3CX:
//   - 3CX Management Console → Call Flow Designer → crea un Flow con HTTP Request component
//   - URL: https://cic-saas.vercel.app/api/centralino-3cx?step=voice
//   - Method: POST
//   - Headers: Content-Type: application/json
//   - Body: { "call_sid": "<CallID>", "from": "<CallerID>", "to": "<DDI>", "step": "voice", "digit": "<UserInput>" }
//
// STATO: STUB iniziale (demo). Logica IVR + parallel ring + segreteria verrà aggiunta quando
// configureremo i webhook lato 3CX (collaborazione con installatore/Plateform).
//
// Flusso target finale:
//   - voice (entry): rispondi con istruzioni IVR ("premi 1 per WhatsApp, premi 2 per parlare")
//   - gather (digit pressed): se 1 → invia WA via 360dialog al chiamante; se 2 → parallel ring smartphones
//   - dial-status: log esito chiamata
//   - voicemail: log segreteria
//
// Variabili ambiente Vercel richieste a regime:
//   D360_API_KEY       (per invio WhatsApp da digit 1)
//   D360_BASE_URL      (default: https://waba-v2.360dialog.io)

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

const D360_API_KEY = process.env.D360_API_KEY || ''
const D360_BASE_URL = process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io'

function normalizePhone(phone) {
  if (!phone) return null
  let p = String(phone).replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (!/^\d{8,15}$/.test(p)) return null
  return p
}

async function sendWhatsAppLink(toNumber, body, opts = {}) {
  if (!D360_API_KEY) return { error: '360dialog non configurato' }
  const phone = normalizePhone(toNumber)
  if (!phone) return { error: 'numero non valido' }
  let payload
  if (opts.templateName) {
    payload = {
      messaging_product: 'whatsapp', to: phone, type: 'template',
      template: {
        name: opts.templateName,
        language: { code: opts.templateLang || 'it' },
        components: opts.templateComponents || [],
      },
    }
  } else {
    payload = { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } }
  }
  const r = await fetch(`${D360_BASE_URL}/messages`, {
    method: 'POST',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.error?.message || `360dialog ${r.status}` }
  return { sid: j.messages?.[0]?.id || null }
}

async function findCustomerByPhone(user_id, locale, phone) {
  if (!phone) return null
  const { data } = await sb.from('customers')
    .select('id, nome, cognome')
    .eq('user_id', user_id).eq('locale', locale).eq('telefono', phone).maybeSingle()
  return data
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const body = req.body || {}
  const step = body.step || req.query.step || 'voice'
  const callSid = body.call_sid || ''
  const from = body.from || ''
  const to = body.to || ''
  const digit = body.digit || ''

  try {
    // Lookup config dal numero To
    const { data: cfg } = await sb.from('centralino_config').select('*').eq('twilio_number', to).maybeSingle()
    // Nota: la colonna si chiama "twilio_number" per legacy, ma rappresenta il numero del centralino (qualsiasi provider).
    // In futuro renaming opzionale a "phone_number".
    if (!cfg) {
      return res.status(200).json({ action: 'hangup', reason: 'numero non configurato' })
    }
    if (!cfg.attivo) {
      return res.status(200).json({ action: 'say', text: cfg.fuori_orario_text || 'Servizio non attivo' })
    }

    const customer = await findCustomerByPhone(cfg.user_id, cfg.locale, from)

    // ─── STEP: voice (entry) ────────────────────────────────────────
    if (step === 'voice') {
      await sb.from('centralino_calls').upsert({
        call_sid: callSid,
        user_id: cfg.user_id,
        locale: cfg.locale,
        from_number: from,
        to_number: to,
        customer_id: customer?.id || null,
      }, { onConflict: 'call_sid' })

      return res.status(200).json({
        action: 'ivr',
        greeting: cfg.greeting_text,
        options: {
          1: cfg.opt1_enabled ? 'whatsapp_link' : null,
          2: cfg.opt2_enabled ? 'parallel_ring' : null,
        },
      })
    }

    // ─── STEP: gather (digit pressed) ───────────────────────────────
    if (step === 'gather') {
      await sb.from('centralino_calls').update({ digit_pressed: digit }).eq('call_sid', callSid)

      // Opt 1: invia link WhatsApp al chiamante
      if (digit === '1' && cfg.opt1_enabled) {
        const link = cfg.prenotazione_url || ''
        const msg = (cfg.whatsapp_template || 'Ciao! Per prenotare clicca: {link}').replace('{link}', link)
        const wa = await sendWhatsAppLink(from, msg)
        await sb.from('centralino_calls').update({
          esito: wa.error ? 'whatsapp_failed' : 'whatsapp_sent',
          whatsapp_msg_sid: wa.sid || null,
          ended_at: new Date().toISOString(),
        }).eq('call_sid', callSid)
        return res.status(200).json({
          action: wa.error ? 'say' : 'say',
          text: wa.error
            ? 'Si è verificato un problema. Riproveremo a contattarvi.'
            : 'Vi abbiamo inviato un messaggio WhatsApp con il link prenotazione. A presto!',
        })
      }

      // Opt 2: parallel ring fissi/cellulari (gestito lato 3CX, qui solo logging)
      if (digit === '2' && cfg.opt2_enabled) {
        const numbers = (cfg.parallel_ring_numbers || []).filter(Boolean)
        if (numbers.length === 0) {
          return res.status(200).json({ action: 'voicemail', text: 'Nessun numero configurato.' })
        }
        return res.status(200).json({
          action: 'dial',
          numbers,
          timeout: cfg.parallel_ring_timeout_sec || 20,
          on_no_answer: cfg.voicemail_enabled ? 'voicemail' : 'hangup',
        })
      }

      return res.status(200).json({ action: 'say', text: 'Scelta non valida.' })
    }

    // ─── STEP: dial-status (callback dopo parallel ring) ────────────
    if (step === 'dial-status') {
      const status = body.dial_status || ''
      const duration = Number(body.duration || 0)
      const answered = status === 'completed' || status === 'answered'
      await sb.from('centralino_calls').update({
        esito: answered ? 'dial_answered' : 'dial_no_answer',
        durata_sec: duration || null,
        ended_at: new Date().toISOString(),
      }).eq('call_sid', callSid)
      return res.status(200).json({ action: answered ? 'hangup' : 'voicemail' })
    }

    // ─── STEP: voicemail (recording finished) ───────────────────────
    if (step === 'voicemail') {
      const recordingUrl = body.recording_url || null
      const duration = Number(body.duration || 0)
      await sb.from('centralino_calls').update({
        esito: 'voicemail',
        recording_url: recordingUrl,
        durata_sec: duration || null,
        ended_at: new Date().toISOString(),
      }).eq('call_sid', callSid)
      return res.status(200).json({ action: 'say', text: 'Grazie. Vi ricontatteremo presto.' })
    }

    return res.status(200).json({ action: 'hangup' })
  } catch (e) {
    console.error('centralino-3cx error', e)
    return res.status(500).json({ error: e.message || String(e) })
  }
}
