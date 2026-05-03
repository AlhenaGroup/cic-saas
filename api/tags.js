// API gestione catalogo tag (tag_definitions) per CRM
// Auth: Bearer JWT — ognuno gestisce solo i propri tag (RLS)

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA'

const sb = createClient(SB_URL, SB_SERVICE)

async function requireUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  return { user }
}

const PRESET_TAGS = [
  { nome: 'VIP',         colore: '#FFD700', icona: 'star',   descrizione: 'Cliente VIP / abituale di alto valore' },
  { nome: 'Frequente',   colore: '#10B981', icona: 'repeat', descrizione: 'Visita ricorrente' },
  { nome: 'Nuovo',       colore: '#3B82F6', icona: 'plus',   descrizione: 'Cliente di prima visita' },
  { nome: 'Dormiente',   colore: '#94A3B8', icona: 'moon',   descrizione: 'Non visita da oltre 60 giorni' },
  { nome: 'Compleanno',  colore: '#EC4899', icona: 'cake',   descrizione: 'Compleanno questo mese' },
  { nome: 'Allergie',    colore: '#F59E0B', icona: 'alert',  descrizione: 'Cliente con intolleranze/allergie' },
  { nome: 'Blacklist',   colore: '#EF4444', icona: 'ban',    descrizione: 'Cliente da non riservare' },
]

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

      // ─── LIST: tag definiti per il locale (autocrea preset al primo accesso) ─
      case 'list': {
        const { locale } = body
        if (!locale) return res.status(400).json({ error: 'locale required' })
        let { data, error } = await sb.from('tag_definitions')
          .select('*')
          .eq('user_id', user_id).eq('locale', locale)
          .order('is_system', { ascending: false })
          .order('nome', { ascending: true })
        if (error) throw error
        if (!data || data.length === 0) {
          // seed preset
          const rows = PRESET_TAGS.map(t => ({ ...t, user_id, locale, is_system: true }))
          const ins = await sb.from('tag_definitions').insert(rows).select()
          if (ins.error) throw ins.error
          data = ins.data
        }
        return res.status(200).json({ tags: data })
      }

      case 'upsert': {
        const t = body.tag || {}
        if (!t.locale || !t.nome) return res.status(400).json({ error: 'locale and nome required' })
        const payload = {
          user_id,
          locale: t.locale,
          nome: t.nome.trim(),
          colore: t.colore || '#94a3b8',
          icona: t.icona || null,
          descrizione: t.descrizione || null,
          is_system: !!t.is_system,
          updated_at: new Date().toISOString(),
        }
        if (t.id) {
          const { data, error } = await sb.from('tag_definitions').update(payload)
            .eq('user_id', user_id).eq('id', t.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ tag: data })
        }
        const { data, error } = await sb.from('tag_definitions').insert(payload).select().maybeSingle()
        if (error) throw error
        return res.status(200).json({ tag: data })
      }

      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        // proteggi i preset is_system? per ora consentiamo (utente puo' personalizzare)
        const { error } = await sb.from('tag_definitions').delete().eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
