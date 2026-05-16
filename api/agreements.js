// API accordi commerciali: CRUD agreements + tiers + items + suppliers + progress.
// Auth: Bearer JWT del ristoratore. Multi-tenant via RLS (user_id = auth.uid()).
//
// Actions (action-style come il resto di cic-saas):
//   list                       lista accordi + supplier + progress sintetico
//   get                        singolo accordo + tiers + items + progress completo
//   upsert                     crea/aggiorna accordo (con tiers e items in transazione logica)
//   delete                     elimina accordo (cascade su tiers/items/snapshots)
//   snapshot                   salva snapshot odierno (chiamabile da cron o manuale)
//   suppliers-list             lista fornitori del tenant
//   suppliers-upsert           crea/aggiorna supplier
//   suppliers-delete           elimina supplier (errore se ha agreements collegati)
//   suppliers-link-invoice     associa una fattura legacy a un supplier

import { createClient } from '@supabase/supabase-js'
import {
  aggregateLines, resolveTiers, linearProjection, periodTiming,
  classifyStatus, computeProgress, computeMixProgress,
} from '../src/lib/agreementProgress.js'

const SB_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co'
const SB_SERVICE = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || ''
const sb = createClient(SB_URL, SB_SERVICE)

async function requireUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'no auth' }
  const { data: { user }, error } = await sb.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }
  return { user }
}

// ─── Caricamento righe fattura per un accordo ──────────────────────
// Filtra warehouse_invoices per supplier_id + periodo + locales, poi prende
// le righe e — se l'accordo ha agreement_items popolato — filtra ulteriormente
// per product_id/category/brand match.
async function loadAgreementLines(user_id, agreement, items) {
  // 1. Trova le fatture rilevanti
  let invQ = sb.from('warehouse_invoices')
    .select('id, data, totale, supplier_id, locale')
    .eq('user_id', user_id)
    .gte('data', agreement.start_date)
    .lte('data', agreement.end_date)
  if (agreement.supplier_id) {
    invQ = invQ.eq('supplier_id', agreement.supplier_id)
  }
  if (Array.isArray(agreement.locales) && agreement.locales.length > 0) {
    invQ = invQ.in('locale', agreement.locales)
  }
  const { data: invoices, error: invErr } = await invQ
  if (invErr) throw invErr
  if (!invoices?.length) return []

  // 2. Carica le righe
  const invoiceIds = invoices.map((i) => i.id)
  const { data: lines, error: lErr } = await sb
    .from('warehouse_invoice_items')
    .select('id, invoice_id, product_id, nome_articolo, quantita, unita, prezzo_totale, qty_singola, totale_um')
    .in('invoice_id', invoiceIds)
  if (lErr) throw lErr
  if (!lines?.length) return []

  // 3. Se l'accordo ha items, filtra le righe per match
  const hasItemsFilter = Array.isArray(items) && items.length > 0
    && !items.some((it) => it.item_type === 'all');
  if (!hasItemsFilter) return lines;

  // Raccogli set di id/etichette di filtro
  const productIds = items.filter((it) => it.item_type === 'product').map((it) => it.item_reference_id);
  const categories = items.filter((it) => it.item_type === 'category').map((it) => String(it.item_reference_id || '').toLowerCase());
  const brands = items.filter((it) => it.item_type === 'brand').map((it) => String(it.item_reference_id || '').toLowerCase());

  // Se ci sono filtri per category/brand servono anche i prodotti per il match
  let productsById = new Map();
  if (categories.length || brands.length) {
    const productIdsInLines = [...new Set(lines.map((l) => l.product_id).filter(Boolean))];
    if (productIdsInLines.length) {
      const { data: prods } = await sb.from('warehouse_products')
        .select('id, categoria, sotto_categoria, nome, fornitore_principale')
        .in('id', productIdsInLines);
      productsById = new Map((prods || []).map((p) => [p.id, p]));
    }
  }

  return lines.filter((l) => {
    if (productIds.includes(l.product_id)) return true;
    const p = productsById.get(l.product_id);
    if (!p) return false;
    if (categories.length && categories.includes(String(p.categoria || '').toLowerCase())) return true;
    if (categories.length && categories.includes(String(p.sotto_categoria || '').toLowerCase())) return true;
    // brand match: confronta nome prodotto e fornitore_principale
    if (brands.length) {
      const nm = String(p.nome || '').toLowerCase();
      const fp = String(p.fornitore_principale || '').toLowerCase();
      if (brands.some((b) => nm.includes(b) || fp.includes(b))) return true;
    }
    return false;
  });
}

// Carica tiers + items e calcola progress per un accordo.
async function progressForAgreement(user_id, agreement) {
  const [tiersResp, itemsResp] = await Promise.all([
    sb.from('agreement_tiers').select('*').eq('agreement_id', agreement.id).order('sort_order'),
    sb.from('agreement_items').select('*').eq('agreement_id', agreement.id),
  ]);
  const tiers = tiersResp.data || [];
  const items = itemsResp.data || [];
  const lines = await loadAgreementLines(user_id, agreement, items);
  const progress = computeProgress(agreement, tiers, lines, new Date());
  const mix = agreement.agreement_type === 'mix_target'
    ? computeMixProgress(items, lines)
    : null;
  return { tiers, items, lines_count: lines.length, progress, mix };
}

// ─── Handler ───────────────────────────────────────────────────────
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
  const nowIso = new Date().toISOString()

  try {
    switch (action) {

      // ─── Agreements ──────────────────────────────────────────────
      case 'list': {
        const { status, supplier_id, limit = 200 } = body
        let q = sb.from('commercial_agreements')
          .select('*, suppliers(id, name, category)')
          .eq('user_id', user_id)
          .order('end_date', { ascending: true })
          .limit(Math.min(500, Number(limit) || 200))
        if (status) q = q.eq('status', status)
        if (supplier_id) q = q.eq('supplier_id', supplier_id)
        const { data, error } = await q
        if (error) throw error

        // Per ogni accordo calcola un progress sintetico
        const withProgress = await Promise.all((data || []).map(async (a) => {
          try {
            const { progress } = await progressForAgreement(user_id, a)
            return { ...a, progress }
          } catch (e) {
            return { ...a, progress: null, progress_error: e.message || String(e) }
          }
        }))
        return res.status(200).json({ agreements: withProgress })
      }

      case 'get': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { data: a, error } = await sb.from('commercial_agreements')
          .select('*, suppliers(id, name, category, vat_number, contact_email, contact_phone)')
          .eq('user_id', user_id).eq('id', id).maybeSingle()
        if (error) throw error
        if (!a) return res.status(404).json({ error: 'not_found' })
        const detail = await progressForAgreement(user_id, a)
        return res.status(200).json({ agreement: a, ...detail })
      }

      case 'upsert': {
        const a = body.agreement || {}
        if (!a.name || !a.agreement_type || !a.metric || !a.start_date || !a.end_date) {
          return res.status(400).json({ error: 'name, agreement_type, metric, start_date, end_date required' })
        }
        const payload = {
          user_id,
          supplier_id: a.supplier_id || null,
          locales:     Array.isArray(a.locales) && a.locales.length ? a.locales : null,
          name: a.name.trim(),
          description: a.description ?? null,
          notes: a.notes ?? null,
          agreement_type: a.agreement_type,
          metric: a.metric,
          start_date: a.start_date,
          end_date: a.end_date,
          status: a.status || 'draft',
          reward_type: a.reward_type ?? null,
          reward_value: a.reward_value != null ? Number(a.reward_value) : null,
          reward_description: a.reward_description ?? null,
          contract_file_url: a.contract_file_url ?? null,
          updated_at: nowIso,
        }

        let row
        if (a.id) {
          const { data, error } = await sb.from('commercial_agreements').update(payload)
            .eq('user_id', user_id).eq('id', a.id).select().maybeSingle()
          if (error) throw error
          row = data
        } else {
          const { data, error } = await sb.from('commercial_agreements').insert(payload).select().maybeSingle()
          if (error) throw error
          row = data
        }

        // Sostituisce tiers e items (semplice: delete + insert)
        if (Array.isArray(a.tiers)) {
          await sb.from('agreement_tiers').delete().eq('agreement_id', row.id)
          if (a.tiers.length > 0) {
            const tiersPayload = a.tiers.map((t, i) => ({
              agreement_id: row.id,
              threshold: Number(t.threshold || 0),
              reward_type: t.reward_type ?? null,
              reward_value: t.reward_value != null ? Number(t.reward_value) : null,
              reward_description: t.reward_description ?? null,
              sort_order: t.sort_order != null ? Number(t.sort_order) : i,
            }))
            const { error: terr } = await sb.from('agreement_tiers').insert(tiersPayload)
            if (terr) throw terr
          }
        }
        if (Array.isArray(a.items)) {
          await sb.from('agreement_items').delete().eq('agreement_id', row.id)
          if (a.items.length > 0) {
            const itemsPayload = a.items.map((it) => ({
              agreement_id: row.id,
              item_type: it.item_type,
              item_reference_id: it.item_reference_id ?? null,
              item_label: it.item_label ?? null,
              weight: it.weight != null ? Number(it.weight) : null,
            }))
            const { error: ierr } = await sb.from('agreement_items').insert(itemsPayload)
            if (ierr) throw ierr
          }
        }

        return res.status(200).json({ agreement: row })
      }

      case 'delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        const { error } = await sb.from('commercial_agreements').delete()
          .eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      case 'snapshot': {
        // Calcola progress odierno e persiste in agreement_progress_snapshots.
        // Se id assente, snapshotta TUTTI gli accordi attivi dell'utente.
        const today = new Date().toISOString().slice(0, 10)
        const ids = body.id ? [body.id] : null
        let q = sb.from('commercial_agreements').select('*').eq('user_id', user_id).eq('status', 'active')
        if (ids) q = q.in('id', ids)
        const { data: agreements } = await q
        const results = []
        for (const a of (agreements || [])) {
          const { progress } = await progressForAgreement(user_id, a)
          const { error } = await sb.from('agreement_progress_snapshots').upsert({
            agreement_id: a.id,
            snapshot_date: today,
            current_value: progress.current_value,
            percentage_complete: progress.percentage_complete,
          }, { onConflict: 'agreement_id,snapshot_date' })
          results.push({ id: a.id, name: a.name, ok: !error, error: error?.message })
        }
        return res.status(200).json({ count: results.length, results })
      }

      // ─── Suppliers ────────────────────────────────────────────────
      case 'suppliers-list': {
        const { data, error } = await sb.from('suppliers')
          .select('*').eq('user_id', user_id).order('name')
        if (error) throw error
        return res.status(200).json({ suppliers: data || [] })
      }

      case 'suppliers-upsert': {
        const s = body.supplier || {}
        if (!s.name?.trim()) return res.status(400).json({ error: 'name required' })
        const payload = {
          user_id,
          name: s.name.trim(),
          vat_number: s.vat_number ?? null,
          contact_email: s.contact_email ?? null,
          contact_phone: s.contact_phone ?? null,
          notes: s.notes ?? null,
          match_aliases: Array.isArray(s.match_aliases) ? s.match_aliases : [],
          category: s.category ?? null,
          updated_at: nowIso,
        }
        if (s.id) {
          const { data, error } = await sb.from('suppliers').update(payload)
            .eq('user_id', user_id).eq('id', s.id).select().maybeSingle()
          if (error) throw error
          return res.status(200).json({ supplier: data })
        }
        const { data, error } = await sb.from('suppliers').insert(payload).select().maybeSingle()
        if (error) {
          if (error.code === '23505') return res.status(409).json({ error: 'supplier_name_already_exists' })
          throw error
        }
        return res.status(200).json({ supplier: data })
      }

      case 'suppliers-delete': {
        const { id } = body
        if (!id) return res.status(400).json({ error: 'id required' })
        // Blocca se ha agreements collegati
        const { count } = await sb.from('commercial_agreements')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user_id).eq('supplier_id', id)
        if (count > 0) {
          return res.status(409).json({ error: 'supplier_has_agreements', count })
        }
        const { error } = await sb.from('suppliers').delete()
          .eq('user_id', user_id).eq('id', id)
        if (error) throw error
        return res.status(200).json({ ok: true })
      }

      // Associa una fattura legacy (warehouse_invoices.supplier_id null) al supplier
      // matchando per nome o aggiungendo un alias.
      case 'suppliers-link-invoice': {
        const { invoice_id, supplier_id, add_alias } = body
        if (!invoice_id || !supplier_id) return res.status(400).json({ error: 'invoice_id and supplier_id required' })

        const { data: inv } = await sb.from('warehouse_invoices')
          .select('id, fornitore').eq('user_id', user_id).eq('id', invoice_id).maybeSingle()
        if (!inv) return res.status(404).json({ error: 'invoice_not_found' })

        await sb.from('warehouse_invoices').update({ supplier_id })
          .eq('user_id', user_id).eq('id', invoice_id)

        if (add_alias && inv.fornitore) {
          const { data: sup } = await sb.from('suppliers').select('match_aliases')
            .eq('user_id', user_id).eq('id', supplier_id).maybeSingle()
          const aliases = new Set([...(sup?.match_aliases || []), inv.fornitore.trim()])
          await sb.from('suppliers').update({ match_aliases: Array.from(aliases) })
            .eq('user_id', user_id).eq('id', supplier_id)
        }
        return res.status(200).json({ ok: true })
      }

      default:
        return res.status(400).json({ error: 'unknown action' })
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) })
  }
}
