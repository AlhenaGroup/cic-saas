// Webhook Twilio per il centralino.
// Endpoint pubblico (no auth utente). Twilio chiama questo URL alla ricezione di chiamate.
// Configurare in Twilio Console il numero acquistato per puntare a:
//   https://<dominio>/api/twilio-webhook?step=voice
//
// Step:
//   - voice         → entry point, risponde con TwiML IVR (greeting + gather)
//   - gather        → riceve digit (1=WA link, 2=parallel ring)
//   - dial-status   → callback al termine del Dial parallelo
//   - voicemail     → callback dopo registrazione segreteria
//
// Variabili ambiente Vercel richieste per attivare:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (es. whatsapp:+14155238886)
//
// Il payload Twilio in POST è form-urlencoded; Vercel lo mette in req.body se body parser è attivo.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

const sb = createClient(SB_URL, SB_SERVICE)

const TW_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TW_WA_FROM = process.env.TWILIO_WHATSAPP_FROM || ''  // es. whatsapp:+14155238886

function xml(twiml) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${twiml}</Response>`
}

function escXml(s) {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Verifica se l'orario corrente rientra negli orari attivi del config (per opt2).
// orari_attivi: { lun:[{from,to}, ...], mar:[...], ... }. Vuoto = sempre attivo.
function isWithinHours(orari) {
  if (!orari || Object.keys(orari).length === 0) return true
  const giorni = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
  const now = new Date()
  const day = giorni[now.getDay()]
  const list = orari[day]
  if (!list || list.length === 0) return false
  const hm = now.toTimeString().slice(0, 5)
  return list.some(slot => hm >= slot.from && hm <= slot.to)
}

async function readFormBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  // Vercel di solito parse-a già application/x-www-form-urlencoded
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => data += c)
    req.on('end', () => {
      const out = {}
      data.split('&').forEach(pair => {
        const [k, v] = pair.split('=')
        if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '))
      })
      resolve(out)
    })
    req.on('error', reject)
  })
}

async function sendWhatsApp(toNumber, body) {
  if (!TW_SID || !TW_TOKEN || !TW_WA_FROM) {
    return { error: 'Twilio WhatsApp non configurato' }
  }
  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`
  const params = new URLSearchParams({ From: TW_WA_FROM, To: to, Body: body })
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

async function findCustomerByPhone(user_id, locale, phone) {
  if (!phone) return null
  const { data } = await sb.from('customers')
    .select('id, nome, cognome')
    .eq('user_id', user_id).eq('locale', locale).eq('telefono', phone).maybeSingle()
  return data
}

export default async function handler(req, res) {
  const step = req.query.step || 'voice'
  res.setHeader('Content-Type', 'text/xml; charset=utf-8')

  try {
    const body = await readFormBody(req)
    const callSid = body.CallSid || ''
    const from    = body.From    || ''
    const to      = body.To      || ''

    // Lookup config dal numero To
    const { data: cfg } = await sb.from('centralino_config').select('*').eq('twilio_number', to).maybeSingle()
    if (!cfg) {
      return res.status(200).send(xml(`<Say language="it-IT">Numero non configurato.</Say><Hangup/>`))
    }
    if (!cfg.attivo) {
      return res.status(200).send(xml(`<Say language="${cfg.lingua}">${escXml(cfg.fuori_orario_text || 'Servizio non attivo.')}</Say><Hangup/>`))
    }

    const customer = await findCustomerByPhone(cfg.user_id, cfg.locale, from)

    // ─── STEP: voice (entry) ─────────────────────────────────────────
    if (step === 'voice') {
      // Crea/aggiorna log chiamata
      await sb.from('centralino_calls').upsert({
        call_sid: callSid,
        user_id: cfg.user_id,
        locale: cfg.locale,
        from_number: from,
        to_number: to,
        customer_id: customer?.id || null,
      }, { onConflict: 'call_sid' })

      const opts = []
      if (cfg.opt1_enabled) opts.push('1')
      if (cfg.opt2_enabled) opts.push('2')

      if (opts.length === 0) {
        // No opzioni → segreteria diretta
        return res.status(200).send(xml(`
          <Say language="${cfg.lingua}">${escXml(cfg.voicemail_text || 'Lasciate un messaggio.')}</Say>
          <Record action="/api/twilio-webhook?step=voicemail" maxLength="120" playBeep="true" trim="trim-silence"/>
          <Hangup/>
        `))
      }

      const greeting = cfg.greeting_mode === 'audio' && cfg.greeting_audio_url
        ? `<Play>${escXml(cfg.greeting_audio_url)}</Play>`
        : `<Say language="${cfg.lingua}">${escXml(cfg.greeting_text)}</Say>`

      return res.status(200).send(xml(`
        <Gather numDigits="1" timeout="6" action="/api/twilio-webhook?step=gather" language="${cfg.lingua}">
          ${greeting}
        </Gather>
        <Say language="${cfg.lingua}">Nessuna scelta ricevuta. Arrivederci.</Say>
        <Hangup/>
      `))
    }

    // ─── STEP: gather (digit pressed) ────────────────────────────────
    if (step === 'gather') {
      const digit = body.Digits || ''
      await sb.from('centralino_calls').update({ digit_pressed: digit }).eq('call_sid', callSid)

      // Opzione 1: invia link WA al chiamante
      if (digit === '1' && cfg.opt1_enabled) {
        const link = cfg.prenotazione_url || ''
        const msg = (cfg.whatsapp_template || 'Ciao! Per prenotare clicca: {link}').replace('{link}', link)
        const wa = await sendWhatsApp(from, msg)
        await sb.from('centralino_calls').update({
          esito: wa.error ? 'whatsapp_failed' : 'whatsapp_sent',
          whatsapp_msg_sid: wa.sid || null,
          ended_at: new Date().toISOString(),
        }).eq('call_sid', callSid)
        return res.status(200).send(xml(`
          <Say language="${cfg.lingua}">${wa.error
            ? 'Si è verificato un problema. Riproveremo a contattarvi.'
            : 'Vi abbiamo inviato un messaggio WhatsApp con il link prenotazione. A presto!'}</Say>
          <Hangup/>
        `))
      }

      // Opzione 2: parallel ring
      if (digit === '2' && cfg.opt2_enabled) {
        if (!isWithinHours(cfg.orari_attivi)) {
          await sb.from('centralino_calls').update({ esito: 'fuori_orario' }).eq('call_sid', callSid)
          if (cfg.voicemail_enabled) {
            return res.status(200).send(xml(`
              <Say language="${cfg.lingua}">${escXml(cfg.fuori_orario_text || cfg.voicemail_text)}</Say>
              <Record action="/api/twilio-webhook?step=voicemail" maxLength="120" playBeep="true" trim="trim-silence"/>
              <Hangup/>
            `))
          }
          return res.status(200).send(xml(`<Say language="${cfg.lingua}">${escXml(cfg.fuori_orario_text)}</Say><Hangup/>`))
        }

        const numbers = (cfg.parallel_ring_numbers || []).filter(Boolean)
        if (numbers.length === 0) {
          return res.status(200).send(xml(`
            <Say language="${cfg.lingua}">Nessun numero configurato. Lasciate un messaggio.</Say>
            <Record action="/api/twilio-webhook?step=voicemail" maxLength="120" playBeep="true" trim="trim-silence"/>
            <Hangup/>
          `))
        }
        const timeout = cfg.parallel_ring_timeout_sec || 20
        const dialNumbers = numbers.map(n => `<Number>${escXml(n)}</Number>`).join('')
        return res.status(200).send(xml(`
          <Dial timeout="${timeout}" action="/api/twilio-webhook?step=dial-status" callerId="${escXml(to)}">
            ${dialNumbers}
          </Dial>
        `))
      }

      // digit non valida
      return res.status(200).send(xml(`
        <Say language="${cfg.lingua}">Scelta non valida.</Say>
        <Hangup/>
      `))
    }

    // ─── STEP: dial-status ───────────────────────────────────────────
    if (step === 'dial-status') {
      const status = body.DialCallStatus || ''
      const dialDur = Number(body.DialCallDuration || 0)
      const answered = status === 'completed'
      await sb.from('centralino_calls').update({
        esito: answered ? 'dial_answered' : 'dial_no_answer',
        durata_sec: dialDur || null,
        ended_at: new Date().toISOString(),
      }).eq('call_sid', callSid)

      if (!answered && cfg.voicemail_enabled) {
        return res.status(200).send(xml(`
          <Say language="${cfg.lingua}">${escXml(cfg.voicemail_text)}</Say>
          <Record action="/api/twilio-webhook?step=voicemail" maxLength="120" playBeep="true" trim="trim-silence"/>
          <Hangup/>
        `))
      }
      return res.status(200).send(xml(`<Hangup/>`))
    }

    // ─── STEP: voicemail (recording finished) ────────────────────────
    if (step === 'voicemail') {
      const recordingUrl = body.RecordingUrl || null
      const recordingDur = Number(body.RecordingDuration || 0)
      await sb.from('centralino_calls').update({
        esito: 'voicemail',
        recording_url: recordingUrl,
        durata_sec: recordingDur || null,
        ended_at: new Date().toISOString(),
      }).eq('call_sid', callSid)
      return res.status(200).send(xml(`
        <Say language="${cfg.lingua}">Grazie. Vi ricontatteremo presto.</Say>
        <Hangup/>
      `))
    }

    return res.status(200).send(xml(`<Hangup/>`))
  } catch (e) {
    console.error('twilio-webhook error', e)
    return res.status(200).send(xml(`<Say language="it-IT">Errore di sistema.</Say><Hangup/>`))
  }
}
