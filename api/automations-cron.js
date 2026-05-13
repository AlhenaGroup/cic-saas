// CRON Vercel: processa la coda eventi automations + esegue step pending.
// Schedula in vercel.json a cadenza frequente (es. ogni 1 min).
//
// Flusso:
//   1) Per ogni evento pending trova automazioni attive che matchano (user_id+locale+trigger_event+filters)
//      crea automation_run + automation_run_steps[trigger node] con stato 'done', poi crea step pending per i next nodes.
//   2) Per ogni run_step pending con schedule_at <= now esegue il nodo:
//      - attesa: schedula i next con schedule_at = now + delay
//      - condizione: valuta la condizione e schedula solo il branch giusto
//      - azione (email/whatsapp/sms/...): esegue side-effect e schedula i next
//      - fine: chiude la run

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const sb = createClient(SB_URL, SB_SERVICE)

// Brevo (email)
const BREVO_API_KEY = process.env.BREVO_API_KEY || ''
const BREVO_FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'mail@cic-saas.it'
const BREVO_FROM_NAME = process.env.BREVO_FROM_NAME || 'CIC SaaS'

// 360dialog (WhatsApp Business API)
const D360_API_KEY = process.env.D360_API_KEY || ''
const D360_BASE_URL = process.env.D360_BASE_URL || 'https://waba-v2.360dialog.io'

// ─── Helpers ────────────────────────────────────────────────────────
function applyPlaceholders(tpl, ctx) {
  return String(tpl || '')
    .replace(/\{nome\}/g, ctx.customer?.nome || '')
    .replace(/\{cognome\}/g, ctx.customer?.cognome || '')
    .replace(/\{locale\}/g, ctx.locale || '')
    .replace(/\{punti\}/g, ctx.punti != null ? String(ctx.punti) : '')
}

// Normalizza numero in formato E.164 senza +. Usato da 360dialog.
function normalizePhone(phone) {
  if (!phone) return null
  let p = String(phone).replace(/[\s\-().]/g, '')
  if (p.startsWith('+')) p = p.slice(1)
  if (!/^\d{8,15}$/.test(p)) return null
  return p
}

// Invio WhatsApp via 360dialog. Per messaggi automation outbound serve template approvato
// passato nel config del nodo (opts.templateName).
async function sendWhatsApp(to, body, opts = {}) {
  if (!D360_API_KEY) return { error: '360dialog non configurato (D360_API_KEY mancante)' }
  const phone = normalizePhone(to)
  if (!phone) return { error: 'numero telefono non valido' }

  let payload
  if (opts.templateName) {
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: opts.templateName,
        language: { code: opts.templateLang || 'it' },
        components: opts.templateComponents || [],
      },
    }
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body },
    }
  }

  const r = await fetch(`${D360_BASE_URL}/messages`, {
    method: 'POST',
    headers: { 'D360-API-KEY': D360_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.error?.message || j.message || `360dialog ${r.status}` }
  return { sid: j.messages?.[0]?.id || null }
}

// Invio email via Brevo. user_id presente per uniformità di firma (per-locale futuro).
async function sendEmail(_user_id, toEmail, subject, body) {
  if (!BREVO_API_KEY) return { error: 'Brevo non configurato (BREVO_API_KEY mancante)' }
  const html = String(body || '').replace(/\n/g, '<br>')
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: BREVO_FROM_EMAIL, name: BREVO_FROM_NAME },
      to: [{ email: toEmail }],
      subject: subject || '(senza oggetto)',
      htmlContent: html,
      headers: { 'X-Mailin-disable-tracking': '1' },
    }),
  })
  const j = await r.json().catch(() => ({}))
  if (r.status >= 200 && r.status < 300) {
    return { sid: j.messageId || null }
  }
  return { error: `brevo ${r.status}: ${j.message || j.code || 'unknown'}` }
}

// ─── Match filtri evento contro automazione ────────────────────────
function matchFilters(filters, payload) {
  if (!filters || Object.keys(filters).length === 0) return true
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'solo_prima_visita') continue   // gestito separatamente con conteggio
    if (payload[k] !== v) return false
  }
  return true
}

async function isFirstVisit(customer_id) {
  if (!customer_id) return false
  const { count } = await sb.from('reservations').select('*', { count: 'exact', head: true })
    .eq('customer_id', customer_id).eq('stato', 'completed')
  return (count || 0) <= 1
}

// ─── Scheduling step ────────────────────────────────────────────────
function delayMs(unit, value) {
  const v = Number(value || 0)
  if (unit === 'min') return v * 60_000
  if (unit === 'hour') return v * 3_600_000
  if (unit === 'day') return v * 86_400_000
  return 0
}

async function scheduleNextSteps(run, fromNode) {
  const nextIds = fromNode.next_node_ids || []
  if (nextIds.length === 0) return
  const { data: nextNodes } = await sb.from('automation_nodes').select('*').in('id', nextIds)
  for (const nn of (nextNodes || [])) {
    let scheduleAt = new Date()
    // Se il prossimo nodo è 'attesa', il delay si applica DOPO che lo eseguiamo (lui stesso schedula i suoi figli con delay).
    await sb.from('automation_run_steps').insert({
      run_id: run.id, node_id: nn.id, stato: 'pending', schedule_at: scheduleAt.toISOString(),
    })
  }
}

async function loadCustomerCtx(customer_id) {
  if (!customer_id) return null
  const { data } = await sb.from('customers').select('*').eq('id', customer_id).maybeSingle()
  return data
}

// ─── Esecuzione singolo step ────────────────────────────────────────
async function executeStep(step) {
  // Mark running
  await sb.from('automation_run_steps').update({ stato: 'running' }).eq('id', step.id)

  const { data: node } = await sb.from('automation_nodes').select('*').eq('id', step.node_id).maybeSingle()
  const { data: run } = await sb.from('automation_runs').select('*').eq('id', step.run_id).maybeSingle()
  if (!node || !run) {
    await sb.from('automation_run_steps').update({ stato: 'failed', errore: 'node or run missing', done_at: new Date().toISOString() }).eq('id', step.id)
    return
  }

  const ctx = run.context || {}
  const customer = ctx.customer || (await loadCustomerCtx(run.customer_id))
  const fullCtx = { ...ctx, customer, locale: ctx.locale }

  let output = {}
  let ok = true
  let errore = null

  try {
    switch (node.tipo) {

      case 'attesa': {
        // schedula i next con delay
        const nextIds = node.next_node_ids || []
        const ms = delayMs(node.config?.unit, node.config?.value)
        const at = new Date(Date.now() + ms).toISOString()
        const { data: nextNodes } = await sb.from('automation_nodes').select('id').in('id', nextIds)
        for (const nn of (nextNodes || [])) {
          await sb.from('automation_run_steps').insert({
            run_id: run.id, node_id: nn.id, stato: 'pending', schedule_at: at,
          })
        }
        output = { wait_until: at }
        break
      }

      case 'condizione': {
        const cfg = node.config || {}
        const fieldVal = ctx.payload?.[cfg.field]
        let pass = false
        switch (cfg.op) {
          case '==': pass = fieldVal == cfg.value; break
          case '!=': pass = fieldVal != cfg.value; break
          case '>=': pass = Number(fieldVal) >= Number(cfg.value); break
          case '<=': pass = Number(fieldVal) <= Number(cfg.value); break
          case '>': pass = Number(fieldVal) > Number(cfg.value); break
          case '<': pass = Number(fieldVal) < Number(cfg.value); break
        }
        const branchId = pass ? cfg.branch_yes_node_id : cfg.branch_no_node_id
        if (branchId) {
          await sb.from('automation_run_steps').insert({
            run_id: run.id, node_id: branchId, stato: 'pending', schedule_at: new Date().toISOString(),
          })
        }
        output = { condition_result: pass }
        break
      }

      case 'invia_email': {
        if (!customer?.email) { ok = false; errore = 'cliente senza email' }
        else {
          const subject = applyPlaceholders(node.config?.oggetto || '', fullCtx)
          const bodyText = applyPlaceholders(node.config?.contenuto || '', fullCtx)
          const r = await sendEmail(run.user_id, customer.email, subject, bodyText)
          if (r.error) { ok = false; errore = r.error } else { output = { sid: r.sid } }
        }
        await scheduleNextSteps(run, node)
        break
      }

      case 'invia_whatsapp': {
        if (!customer?.telefono) { ok = false; errore = 'cliente senza telefono' }
        else {
          const text = applyPlaceholders(node.config?.contenuto || '', fullCtx)
          // Se il nodo specifica template_name, lo usiamo (richiesto per outbound oltre 24h window)
          const opts = node.config?.template_name ? {
            templateName: node.config.template_name,
            templateLang: node.config.template_lang || 'it',
            templateComponents: node.config.template_components || [],
          } : {}
          const r = await sendWhatsApp(customer.telefono, text, opts)
          if (r.error) { ok = false; errore = r.error } else { output = { sid: r.sid } }
        }
        await scheduleNextSteps(run, node)
        break
      }

      case 'invia_sms': {
        // SMS disabilitato (Italia: i clienti usano WhatsApp).
        // Per riattivare: re-introdurre provider SMS (Twilio o italiano dedicato).
        ok = false; errore = 'canale SMS non attivo'
        await scheduleNextSteps(run, node)
        break
      }

      case 'modifica_tag': {
        const cfg = node.config || {}
        if (!customer?.id) { ok = false; errore = 'no customer' }
        else {
          let tagId = cfg.tag_id
          if (!tagId && cfg.tag_nome) {
            const { data: tg } = await sb.from('tag_definitions').select('id')
              .eq('user_id', run.user_id).eq('locale', run.context?.locale).eq('nome', cfg.tag_nome).maybeSingle()
            tagId = tg?.id
          }
          if (!tagId) { ok = false; errore = 'tag non trovato' }
          else if (cfg.action === 'remove') {
            await sb.from('customer_tags').delete().eq('customer_id', customer.id).eq('tag_id', tagId)
          } else {
            await sb.from('customer_tags').upsert({ customer_id: customer.id, tag_id: tagId })
          }
        }
        await scheduleNextSteps(run, node)
        break
      }

      case 'punti_fidelity': {
        const cfg = node.config || {}
        if (!customer?.id) { ok = false; errore = 'no customer' }
        else {
          const { data: prog } = await sb.from('fidelity_programs').select('*')
            .eq('user_id', run.user_id).eq('locale', run.context?.locale).maybeSingle()
          if (!prog) { ok = false; errore = 'programma fidelity non configurato' }
          else {
            let punti = Number(cfg.punti_fissi || 0)
            const importo = Number(ctx.payload?.importo || 0)
            if (cfg.punti_per_euro && importo > 0) {
              punti += Math.floor(importo * Number(cfg.punti_per_euro))
            }
            if (punti > 0) {
              const expires = prog.durata_punti_giorni
                ? new Date(Date.now() + prog.durata_punti_giorni * 86400000).toISOString()
                : null
              await sb.from('fidelity_movements').insert({
                user_id: run.user_id, customer_id: customer.id, program_id: prog.id,
                tipo: 'accumulo', punti, expires_at: expires, note: 'da automazione'
              })
              output = { punti_accumulati: punti }
            }
          }
        }
        await scheduleNextSteps(run, node)
        break
      }

      case 'invia_webhook': {
        const cfg = node.config || {}
        if (!cfg.url) { ok = false; errore = 'webhook senza url' }
        else {
          try {
            const r = await fetch(cfg.url, {
              method: cfg.method || 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ context: fullCtx, automation_id: run.automation_id }),
            })
            output = { status: r.status }
          } catch (e) { ok = false; errore = e.message }
        }
        await scheduleNextSteps(run, node)
        break
      }

      case 'invito_sondaggio': {
        // crea invitation + invia link via canale (whatsapp default, fallback email)
        const cfg = node.config || {}
        if (!customer?.id) { ok = false; errore = 'no customer'; break }
        let surveyId = cfg.survey_id
        if (!surveyId) {
          // fallback: primo sondaggio attivo del locale
          const { data: s } = await sb.from('surveys').select('id')
            .eq('user_id', run.user_id).eq('locale', run.context?.locale).eq('attivo', true)
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
          surveyId = s?.id
        }
        if (!surveyId) { ok = false; errore = 'nessun sondaggio attivo' }
        else {
          const { randomUUID } = await import('node:crypto')
          const token = randomUUID()
          const scadenza = new Date(Date.now() + 14 * 86400000).toISOString()
          await sb.from('survey_invitations').insert({
            user_id: run.user_id, locale: run.context?.locale, survey_id: surveyId,
            customer_id: customer.id, token, canale: cfg.canale || 'whatsapp', scadenza_at: scadenza,
          })
          const baseUrl = process.env.PUBLIC_BASE_URL || 'https://cic-saas.vercel.app'
          const link = `${baseUrl}/survey/${token}`
          const text = applyPlaceholders(cfg.contenuto || `Ciao {nome}, ci aiuti con un breve feedback? ${link}`, fullCtx).replace('{link}', link)
          const canale = cfg.canale || (customer.telefono ? 'whatsapp' : 'email')
          if (canale === 'email' && customer.email) {
            const subj = applyPlaceholders(cfg.oggetto || 'Il tuo feedback è importante', fullCtx)
            const r = await sendEmail(run.user_id, customer.email, subj, text)
            if (r.error) { ok = false; errore = r.error } else output = { sid: r.sid, link }
          } else if (customer.telefono) {
            const r = await sendWhatsApp(customer.telefono, text)
            if (r.error) { ok = false; errore = r.error } else output = { sid: r.sid, link }
          } else { ok = false; errore = 'cliente senza email/telefono' }
        }
        await scheduleNextSteps(run, node)
        break
      }

      case 'invito_recensione':
      case 'invia_promozione':
        // placeholder: implementare in fasi successive
        output = { placeholder: true }
        await scheduleNextSteps(run, node)
        break

      case 'fine':
        // chiude la run
        await sb.from('automation_runs').update({ stato: 'completed', ended_at: new Date().toISOString() }).eq('id', run.id)
        break

      default:
        ok = false; errore = `tipo nodo non supportato: ${node.tipo}`
    }
  } catch (e) {
    ok = false; errore = e.message || String(e)
  }

  await sb.from('automation_run_steps').update({
    stato: ok ? 'done' : 'failed',
    errore,
    output,
    done_at: new Date().toISOString(),
  }).eq('id', step.id)
}

// ─── Main: process queue + execute pending steps ────────────────────
export default async function handler(req, res) {
  try {
    // 1) Process pending events (matching create runs)
    const { data: events } = await sb.from('automation_events_queue')
      .select('*').eq('stato', 'pending').order('created_at').limit(100)

    for (const ev of (events || [])) {
      try {
        const { data: automations } = await sb.from('automations').select('*')
          .eq('user_id', ev.user_id).eq('locale', ev.locale)
          .eq('trigger_event', ev.evento).eq('attivo', true)

        for (const aut of (automations || [])) {
          // filtro
          if (!matchFilters(aut.trigger_filters, ev.payload || {})) continue
          if (aut.trigger_filters?.solo_prima_visita && !(await isFirstVisit(ev.customer_id))) continue

          // trova nodo trigger e i suoi next
          const { data: trigger } = await sb.from('automation_nodes').select('*')
            .eq('automation_id', aut.id).eq('tipo', 'trigger').maybeSingle()
          if (!trigger) continue

          const customer = ev.customer_id ? await loadCustomerCtx(ev.customer_id) : null
          const ctx = { locale: ev.locale, payload: ev.payload, customer }

          const { data: run } = await sb.from('automation_runs').insert({
            automation_id: aut.id, event_id: ev.id, user_id: ev.user_id,
            customer_id: ev.customer_id, context: ctx, stato: 'running',
          }).select().maybeSingle()

          // schedula step per i next del trigger
          const nextIds = trigger.next_node_ids || []
          for (const nid of nextIds) {
            await sb.from('automation_run_steps').insert({
              run_id: run.id, node_id: nid, stato: 'pending', schedule_at: new Date().toISOString(),
            })
          }

          await sb.from('automations').update({
            esecuzioni_totali: (aut.esecuzioni_totali || 0) + 1,
            ultime_esecuzione_at: new Date().toISOString(),
          }).eq('id', aut.id)
        }
        await sb.from('automation_events_queue').update({ stato: 'processed', processed_at: new Date().toISOString() }).eq('id', ev.id)
      } catch (e) {
        await sb.from('automation_events_queue').update({ stato: 'error', errore: e.message || String(e), processed_at: new Date().toISOString() }).eq('id', ev.id)
      }
    }

    // 2) Execute pending steps with schedule_at <= now — parallelo con concurrency limit
    //    per non saturare upstream (360dialog/Brevo) e restare entro il timeout Vercel.
    const { data: steps } = await sb.from('automation_run_steps').select('*')
      .eq('stato', 'pending').lte('schedule_at', new Date().toISOString())
      .order('schedule_at').limit(200)

    const CONCURRENCY = 8
    let executed = 0, failed = 0
    const queue = [...(steps || [])]
    async function worker() {
      while (queue.length) {
        const s = queue.shift()
        if (!s) return
        try { await executeStep(s); executed++ }
        catch (e) { failed++; console.error('step error', s.id, e) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

    return res.status(200).json({ ok: true, events_processed: events?.length || 0, steps_executed: executed, steps_failed: failed })
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
