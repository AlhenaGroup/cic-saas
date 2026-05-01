// Resoconto giornaliero via email — cron Vercel ogni mattina alle 06:00
// + endpoint manuale per "Invia ora di prova" dalla dashboard.
//
// Per ogni utente con daily_report_settings.enabled=true:
//  1. Aggrega i dati del giorno prima da daily_stats
//  2. Per ogni recipient costruisce HTML con SOLO le sezioni abilitate
//     (recipient.sections override default_sections)
//  3. Invia tramite Gmail API (refresh_token utente da google_tokens)
//
// L'utente connette il proprio Gmail via OAuth (scope gmail.send) dalla
// pagina di configurazione resoconto.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

const sbHeaders = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }

async function sb(path, init = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers || {}) },
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`Supabase ${r.status}: ${t.slice(0, 200)}`)
  }
  return r.status === 204 ? null : r.json()
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function fmtEur(n) {
  if (n == null || isNaN(n)) return '—'
  return '€ ' + Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Refresh access token Gmail
async function refreshGoogleToken(refreshToken) {
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
  if (!r.ok) throw new Error('refresh_token failed: ' + r.status + ' ' + await r.text())
  return (await r.json()).access_token
}

// Invia email via Gmail API
async function sendGmail(accessToken, fromEmail, toEmail, subject, htmlBody) {
  const raw = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
  ].join('\r\n')
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  })
  if (!r.ok) throw new Error('Gmail send failed: ' + r.status + ' ' + await r.text())
  return r.json()
}

// Aggrega dati del giorno per un user_id
async function aggregateDay(userId, date) {
  // daily_stats per il giorno + filtro user (in realtà daily_stats non ha user_id, è globale per salespoint)
  // Filtriamo via salespoints: l'utente vede solo i suoi (configurati in user_settings.sales_points o direttamente).
  // Semplificazione: prendiamo tutte le righe del giorno, e l'utente vedrà solo quelle che il sistema gli associa.
  const stats = await sb(`daily_stats?date=eq.${date}&select=date,salespoint_id,salespoint_name,revenue,bill_count,coperti,top_products,dept_records,first_receipt_time,last_receipt_time,fiscal_close_time,hourly_records`)
  return Array.isArray(stats) ? stats : []
}

function buildEmailHtml({ date, dayName, stats, comparisonStats, sections }) {
  const totals = stats.reduce((acc, s) => {
    acc.revenue += Number(s.revenue || 0)
    acc.bill_count += Number(s.bill_count || 0)
    acc.coperti += Number(s.coperti || 0)
    return acc
  }, { revenue: 0, bill_count: 0, coperti: 0 })
  const compTotals = (comparisonStats || []).reduce((acc, s) => {
    acc.revenue += Number(s.revenue || 0)
    acc.bill_count += Number(s.bill_count || 0)
    acc.coperti += Number(s.coperti || 0)
    return acc
  }, { revenue: 0, bill_count: 0, coperti: 0 })

  const pctDelta = (a, b) => b > 0 ? ((a - b) / b * 100) : null
  const fmtPct = (p) => p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%'
  const colorPct = (p) => p == null ? '#999' : (p >= 0 ? '#10B981' : '#EF4444')

  let html = `<!DOCTYPE html><html><body style="font-family: -apple-system, system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333;">
<div style="max-width: 640px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08);">
  <div style="background: linear-gradient(135deg, #F59E0B, #EF4444); color: #fff; padding: 24px; text-align: center;">
    <div style="font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px;">Resoconto giornaliero</div>
    <div style="font-size: 22px; font-weight: 700; margin-top: 4px;">${escapeHtml(dayName)} ${escapeHtml(date)}</div>
  </div>
  <div style="padding: 24px;">`

  if (sections.vendite) {
    html += `<h2 style="font-size: 16px; margin: 0 0 12px; color: #111;">📊 Vendite del giorno</h2>
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
  <tr>
    <td style="padding: 12px; background: #fef3c7; border-radius: 8px; width: 33%;">
      <div style="font-size: 11px; color: #92400e; text-transform: uppercase;">Ricavi</div>
      <div style="font-size: 22px; font-weight: 700; color: #92400e;">${fmtEur(totals.revenue)}</div>
    </td>
    <td style="width: 4px;"></td>
    <td style="padding: 12px; background: #dbeafe; border-radius: 8px; width: 33%;">
      <div style="font-size: 11px; color: #1e40af; text-transform: uppercase;">Scontrini</div>
      <div style="font-size: 22px; font-weight: 700; color: #1e40af;">${totals.bill_count}</div>
    </td>
    <td style="width: 4px;"></td>
    <td style="padding: 12px; background: #d1fae5; border-radius: 8px; width: 33%;">
      <div style="font-size: 11px; color: #065f46; text-transform: uppercase;">Coperti</div>
      <div style="font-size: 22px; font-weight: 700; color: #065f46;">${totals.coperti}</div>
    </td>
  </tr>
</table>`

    if (stats.length > 0) {
      html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
  <thead><tr style="background: #f9fafb;">
    <th style="padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb;">Locale</th>
    <th style="padding: 8px; text-align: right; border-bottom: 1px solid #e5e7eb;">Ricavi</th>
    <th style="padding: 8px; text-align: right; border-bottom: 1px solid #e5e7eb;">Scontrini</th>
    <th style="padding: 8px; text-align: right; border-bottom: 1px solid #e5e7eb;">Coperti</th>
  </tr></thead><tbody>`
      stats.forEach(s => {
        html += `<tr>
  <td style="padding: 8px; border-bottom: 1px solid #f3f4f6;">${escapeHtml(s.salespoint_name || '—')}</td>
  <td style="padding: 8px; text-align: right; border-bottom: 1px solid #f3f4f6; font-weight: 600;">${fmtEur(s.revenue)}</td>
  <td style="padding: 8px; text-align: right; border-bottom: 1px solid #f3f4f6;">${s.bill_count || 0}</td>
  <td style="padding: 8px; text-align: right; border-bottom: 1px solid #f3f4f6;">${s.coperti || 0}</td>
</tr>`
      })
      html += `</tbody></table>`
    }
  }

  if (sections.confronto && comparisonStats?.length > 0) {
    html += `<h2 style="font-size: 16px; margin: 24px 0 12px; color: #111;">📈 Confronto stessa giornata settimana scorsa</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 13px;">
  <tr>
    <td style="padding: 10px; background: #f9fafb;">
      Ricavi: <strong>${fmtEur(totals.revenue)}</strong> vs ${fmtEur(compTotals.revenue)}
      <span style="float: right; color: ${colorPct(pctDelta(totals.revenue, compTotals.revenue))}; font-weight: 700;">${fmtPct(pctDelta(totals.revenue, compTotals.revenue))}</span>
    </td>
  </tr>
  <tr>
    <td style="padding: 10px;">
      Scontrini: <strong>${totals.bill_count}</strong> vs ${compTotals.bill_count}
      <span style="float: right; color: ${colorPct(pctDelta(totals.bill_count, compTotals.bill_count))}; font-weight: 700;">${fmtPct(pctDelta(totals.bill_count, compTotals.bill_count))}</span>
    </td>
  </tr>
  <tr>
    <td style="padding: 10px; background: #f9fafb;">
      Coperti: <strong>${totals.coperti}</strong> vs ${compTotals.coperti}
      <span style="float: right; color: ${colorPct(pctDelta(totals.coperti, compTotals.coperti))}; font-weight: 700;">${fmtPct(pctDelta(totals.coperti, compTotals.coperti))}</span>
    </td>
  </tr>
</table>`
  }

  if (sections.personale) {
    // Placeholder - lo riempiamo con dati attendance in v2
    html += `<h2 style="font-size: 16px; margin: 24px 0 12px; color: #111;">👥 Personale del turno</h2>
<div style="padding: 12px; background: #f9fafb; border-radius: 8px; color: #6b7280; font-size: 13px;">
  Sezione in fase di sviluppo. Ore reali, costo personale stimato e produttività €/h saranno aggiunti prossimamente.
</div>`
  }

  if (sections.alert) {
    html += `<h2 style="font-size: 16px; margin: 24px 0 12px; color: #111;">⚠️ Alert</h2>
<div style="padding: 12px; background: #f9fafb; border-radius: 8px; color: #6b7280; font-size: 13px;">
  Sezione in fase di sviluppo. Articoli sotto soglia, allerta prezzi e checklist non completate saranno mostrate qui.
</div>`
  }

  html += `</div>
  <div style="padding: 16px 24px; background: #f9fafb; color: #6b7280; font-size: 11px; text-align: center;">
    Generato automaticamente da CIC Analytics · Dashboard Alhena
  </div>
</div></body></html>`
  return html
}

async function processUser(setting, dateOverride) {
  const userId = setting.user_id
  // Recupera token Google
  const tokens = await sb(`google_tokens?user_id=eq.${userId}&select=access_token,refresh_token,token_expiry&limit=1`)
  if (!tokens?.[0]) {
    return { userId, error: 'Gmail non connesso (manca refresh_token)' }
  }
  let accessToken
  try {
    accessToken = await refreshGoogleToken(tokens[0].refresh_token)
  } catch (e) {
    return { userId, error: 'Impossibile rinfrescare token Gmail: ' + e.message }
  }

  // Email mittente: la deduciamo dall'userinfo
  let fromEmail = 'me'
  try {
    const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }).then(r => r.json())
    fromEmail = u.email || 'me'
  } catch {}

  // Date: ieri per il report, settimana scorsa stesso giorno per il confronto
  const targetDate = dateOverride || new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const compareDate = new Date(new Date(targetDate).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const dt = new Date(targetDate + 'T12:00:00')
  const dayName = dt.toLocaleDateString('it-IT', { weekday: 'long' })

  const stats = await aggregateDay(userId, targetDate)
  const compStats = await aggregateDay(userId, compareDate)

  const recipients = Array.isArray(setting.recipients) ? setting.recipients : []
  const defaults = setting.default_sections || { vendite: true, confronto: true, personale: true, alert: true }

  const results = []
  for (const r of recipients) {
    if (!r?.email) continue
    const sections = r.sections && typeof r.sections === 'object' ? { ...defaults, ...r.sections } : defaults
    const html = buildEmailHtml({ date: targetDate, dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1), stats, comparisonStats: compStats, sections })
    const subject = `📊 Resoconto ${targetDate} · ${r.ruolo || 'CIC Analytics'}`
    try {
      await sendGmail(accessToken, fromEmail, r.email, subject, html)
      results.push({ email: r.email, ok: true })
    } catch (e) {
      results.push({ email: r.email, ok: false, error: e.message })
    }
  }

  // Aggiorna last_sent_at + last_error
  const errs = results.filter(x => !x.ok)
  await sb(`daily_report_settings?user_id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      last_sent_at: new Date().toISOString(),
      last_error: errs.length ? errs.map(e => e.email + ': ' + e.error).join('; ') : null,
    }),
  })

  return { userId, fromEmail, targetDate, results }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // GET = cron Vercel (chiamato alle 06:00). Processa TUTTI gli utenti enabled.
  // POST = trigger manuale "invia ora" dalla dashboard, processa SOLO quell'user_id (passato in body).
  try {
    if (req.method === 'GET') {
      const all = await sb(`daily_report_settings?enabled=eq.true&select=*`)
      const out = []
      for (const setting of (all || [])) {
        try { out.push(await processUser(setting)) }
        catch (e) { out.push({ userId: setting.user_id, error: e.message }) }
      }
      return res.status(200).json({ ok: true, processed: out.length, results: out })
    }

    if (req.method === 'POST') {
      const { user_id, date } = req.body || {}
      if (!user_id) return res.status(400).json({ error: 'user_id richiesto' })
      const settings = await sb(`daily_report_settings?user_id=eq.${user_id}&select=*&limit=1`)
      if (!settings?.[0]) return res.status(404).json({ error: 'Configurazione resoconto non trovata. Crea prima la configurazione dalla dashboard.' })
      const result = await processUser(settings[0], date || null)
      return res.status(200).json(result)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('[DAILY-REPORT]', e)
    return res.status(500).json({ error: e.message })
  }
}
