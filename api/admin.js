// Endpoint admin: gestisce utenti, piani, override.
// Auth: il client passa il proprio JWT in header Authorization.
// L'API verifica che l'utente sia in `admins` prima di rispondere.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

const sb = createClient(SB_URL, SB_SERVICE)

async function requireAdmin(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  const { data: adm } = await sb.from('admins').select('role').eq('user_id', user.id).maybeSingle()
  if (!adm) return { error: 'not admin' }
  return { user, role: adm.role }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(401).json({ error: auth.error })

  const { action } = req.body || {}

  try {
    switch (action) {
      // ─── USERS ─────────────────────────────────────────────────────
      case 'list-users': {
        // 1) Tutti gli auth.users via admin API
        const { data: usersData, error: e1 } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
        if (e1) throw e1
        const users = usersData.users || []
        const ids = users.map(u => u.id)
        // 2) Piani assegnati
        const { data: plans } = await sb.from('user_plans').select('user_id, plan_id, active, trial_until, valid_until, notes').in('user_id', ids)
        const planMap = {}
        ;(plans || []).forEach(p => { planMap[p.user_id] = p })
        // 3) Overrides
        const { data: ovs } = await sb.from('user_feature_overrides').select('user_id, extra, exclude').in('user_id', ids)
        const ovMap = {}
        ;(ovs || []).forEach(o => { ovMap[o.user_id] = o })
        // 4) Admin status
        const { data: admins } = await sb.from('admins').select('user_id, role').in('user_id', ids)
        const adminMap = {}
        ;(admins || []).forEach(a => { adminMap[a.user_id] = a.role })
        // Combine
        return res.status(200).json({
          users: users.map(u => ({
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            plan: planMap[u.id] || null,
            overrides: ovMap[u.id] || null,
            admin_role: adminMap[u.id] || null,
          })),
        })
      }

      case 'update-user-plan': {
        const { user_id, plan_id, valid_until, trial_until, active, notes } = req.body
        if (!user_id || !plan_id) return res.status(400).json({ error: 'user_id e plan_id richiesti' })
        const { error } = await sb.from('user_plans').upsert({
          user_id, plan_id,
          valid_until: valid_until || null,
          trial_until: trial_until || null,
          active: active !== false,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'set-overrides': {
        const { user_id, extra, exclude } = req.body
        if (!user_id) return res.status(400).json({ error: 'user_id richiesto' })
        const { error } = await sb.from('user_feature_overrides').upsert({
          user_id,
          extra: extra || {},
          exclude: exclude || {},
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // ─── PLANS ─────────────────────────────────────────────────────
      case 'list-plans': {
        const { data, error } = await sb.from('feature_plans').select('*').order('id')
        if (error) throw error
        return res.status(200).json({ plans: data || [] })
      }

      case 'save-plan': {
        const { id, name, description, price_monthly, price_yearly, features, is_default } = req.body
        if (!id || !name) return res.status(400).json({ error: 'id e name richiesti' })
        const { error } = await sb.from('feature_plans').upsert({
          id, name,
          description: description || null,
          price_monthly: price_monthly != null ? Number(price_monthly) : null,
          price_yearly: price_yearly != null ? Number(price_yearly) : null,
          features: features || { tabs: [], widgets: [] },
          is_default: !!is_default,
          updated_at: new Date().toISOString(),
        })
        if (error) throw error
        // Se imposto questo come default, tolgo il flag dagli altri
        if (is_default) {
          await sb.from('feature_plans').update({ is_default: false }).neq('id', id).eq('is_default', true)
        }
        return res.status(200).json({ ok: true })
      }

      // ─── USER SETTINGS (configurazione CiC per conto del cliente) ────
      case 'get-user-settings': {
        const { user_id } = req.body
        if (!user_id) return res.status(400).json({ error: 'user_id richiesto' })
        const { data } = await sb.from('user_settings').select('*').eq('user_id', user_id).maybeSingle()
        return res.status(200).json({ settings: data || null })
      }

      case 'set-user-settings': {
        const { user_id, cic_api_key, sales_points, plateform_api_key, plateform_location_map } = req.body
        if (!user_id) return res.status(400).json({ error: 'user_id richiesto' })
        const payload = { user_id, updated_at: new Date().toISOString() }
        if (cic_api_key !== undefined) payload.cic_api_key = cic_api_key
        if (sales_points !== undefined) payload.sales_points = sales_points
        if (plateform_api_key !== undefined) payload.plateform_api_key = plateform_api_key
        if (plateform_location_map !== undefined) payload.plateform_location_map = plateform_location_map
        const { error } = await sb.from('user_settings').upsert(payload, { onConflict: 'user_id' })
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'sync-salespoints': {
        // Chiama API CiC con la apiKey fornita per recuperare la lista locali
        const { cic_api_key } = req.body
        if (!cic_api_key) return res.status(400).json({ error: 'cic_api_key richiesta' })
        const tokRes = await fetch('https://api.cassainnuvola.it/v2/account/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: cic_api_key })
        })
        if (!tokRes.ok) return res.status(400).json({ error: 'apiKey CiC non valida (login fallito)' })
        const tokData = await tokRes.json()
        const token = tokData.token || tokData.accessToken
        const spRes = await fetch('https://api.cassainnuvola.it/v2/salespoint?hasActiveLicense=true', {
          headers: { 'Authorization': 'Bearer ' + token }
        })
        if (!spRes.ok) return res.status(400).json({ error: 'lettura salespoint fallita' })
        const spData = await spRes.json()
        const list = Array.isArray(spData.salesPoint) ? spData.salesPoint : (Array.isArray(spData) ? spData : [])
        return res.status(200).json({ salespoints: list })
      }

      case 'create-user': {
        // Crea nuovo utente cliente: email, password, plan_id (opzionale)
        const { email, password, plan_id } = req.body
        if (!email || !password) return res.status(400).json({ error: 'email e password richiesti' })
        const { data: created, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
        if (error) throw error
        const newId = created.user.id
        // Assegna piano (default se non specificato)
        let pid = plan_id
        if (!pid) {
          const { data: defPlan } = await sb.from('feature_plans').select('id').eq('is_default', true).limit(1).single()
          pid = defPlan?.id || 'full'
        }
        await sb.from('user_plans').upsert({ user_id: newId, plan_id: pid, active: true }, { onConflict: 'user_id' })
        return res.status(200).json({ ok: true, user_id: newId })
      }

      case 'delete-plan': {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id richiesto' })
        // Blocca delete se utenti assegnati
        const { count } = await sb.from('user_plans').select('user_id', { count: 'exact', head: true }).eq('plan_id', id)
        if (count > 0) return res.status(400).json({ error: `Piano usato da ${count} utenti. Riassegnali prima.` })
        const { error } = await sb.from('feature_plans').delete().eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      default:
        return res.status(400).json({ error: 'action sconosciuta: ' + action })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
