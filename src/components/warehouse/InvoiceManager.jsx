import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmt } from '../shared/styles.jsx'

const iS = S.input
const formS = { ...iS, width: '100%', marginBottom: 8 }
const STATUS_COLORS = {
  bozza:    { c: '#F59E0B', bg: 'rgba(245,158,11,.12)' },
  completa: { c: '#10B981', bg: 'rgba(16,185,129,.12)' },
  parziale: { c: '#3B82F6', bg: 'rgba(59,130,246,.12)' },
}

export default function InvoiceManager() {
  const [invoices, setInvoices] = useState([])
  const [items, setItems] = useState([])
  const [products, setProducts] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ data: '', numero: '', fornitore: '', locale: '', totale: '', tipo_doc: 'fattura' })
  const [expanded, setExpanded] = useState(null)
  const [itemForm, setItemForm] = useState({ nome_fattura: '', quantita: '', unita: '', prezzo_unitario: '', prezzo_totale: '' })
  const [matchSearch, setMatchSearch] = useState('')
  const [matchResults, setMatchResults] = useState([])
  const [matchingItem, setMatchingItem] = useState(null)
  const [aliases, setAliases] = useState([])
  const [autoMatched, setAutoMatched] = useState({})
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const { data: inv } = await supabase.from('warehouse_invoices').select('*').order('data', { ascending: false })
    setInvoices(inv || [])
    const { data: prods } = await supabase.from('warehouse_products').select('id, nome, categoria, unita_misura').eq('attivo', true).order('nome')
    setProducts(prods || [])
    const { data: als } = await supabase.from('warehouse_aliases').select('id, product_id, alias')
    setAliases(als || [])
  }, [])

  const loadItems = useCallback(async (invoiceId) => {
    const { data } = await supabase.from('warehouse_invoice_items').select('*').eq('invoice_id', invoiceId).order('id')
    setItems(data || [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (expanded) loadItems(expanded) }, [expanded, loadItems])
  useEffect(() => { if (items.length > 0 && products.length > 0) autoMatchItems(items) }, [items, products, aliases])

  const saveInvoice = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('warehouse_invoices').insert({
      user_id: user.id, data: form.data, numero: form.numero, fornitore: form.fornitore,
      locale: form.locale, totale: parseFloat(form.totale) || 0, tipo_doc: form.tipo_doc, stato: 'bozza',
    })
    setForm({ data: '', numero: '', fornitore: '', locale: '', totale: '', tipo_doc: 'fattura' })
    setShowForm(false); await load(); setLoading(false)
  }

  const addItem = async () => {
    if (!expanded) return
    setLoading(true)
    await supabase.from('warehouse_invoice_items').insert({
      invoice_id: expanded, nome_fattura: itemForm.nome_fattura,
      quantita: parseFloat(itemForm.quantita) || 0, unita: itemForm.unita,
      prezzo_unitario: parseFloat(itemForm.prezzo_unitario) || 0,
      prezzo_totale: parseFloat(itemForm.prezzo_totale) || 0, stato_match: 'non_abbinato',
    })
    setItemForm({ nome_fattura: '', quantita: '', unita: '', prezzo_unitario: '', prezzo_totale: '' })
    await loadItems(expanded); setLoading(false)
  }

  const deleteItem = async (id) => {
    await supabase.from('warehouse_invoice_items').delete().eq('id', id)
    if (expanded) await loadItems(expanded)
  }

  const fuzzyScore = (keywords, text) => {
    if (!text) return 0
    const lower = text.toLowerCase()
    let score = 0, allMatch = true
    for (const kw of keywords) {
      if (lower.includes(kw)) { score += kw.length + 1 } else { allMatch = false }
    }
    // Bonus for exact full match
    if (lower === keywords.join(' ')) score += 10
    return allMatch ? score + keywords.length : score > 0 ? score * 0.5 : 0
  }

  const searchProducts = async (q) => {
    setMatchSearch(q)
    if (q.length < 2) { setMatchResults([]); return }
    const keywords = q.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
    if (keywords.length === 0) { setMatchResults([]); return }

    const scored = products.map(p => {
      const nameScore = fuzzyScore(keywords, p.nome)
      // Check aliases for this product
      const prodAliases = aliases.filter(a => a.product_id === p.id)
      const aliasScore = prodAliases.reduce((best, a) => Math.max(best, fuzzyScore(keywords, a.alias)), 0)
      const bestScore = Math.max(nameScore, aliasScore)
      const matchedVia = aliasScore > nameScore ? 'alias' : 'nome'
      return { ...p, score: bestScore, matchedVia }
    }).filter(p => p.score > 0)

    scored.sort((a, b) => b.score - a.score)
    setMatchResults(scored.slice(0, 5))
  }

  const autoMatchItems = async (itemsList) => {
    const matched = {}
    for (const it of itemsList) {
      if (it.stato_match === 'abbinato') continue
      // Check if alias already exists
      const existingAlias = aliases.find(a => a.alias.toLowerCase() === it.nome_fattura.toLowerCase())
      if (existingAlias) {
        matched[it.id] = existingAlias.product_id
        continue
      }
      // Try fuzzy auto-match with high confidence
      const keywords = it.nome_fattura.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
      if (keywords.length === 0) continue
      const best = products.reduce((acc, p) => {
        const s = fuzzyScore(keywords, p.nome)
        return s > acc.score ? { product: p, score: s } : acc
      }, { product: null, score: 0 })
      if (best.product && best.score >= keywords.length * 3) {
        matched[it.id] = best.product.id
      }
    }
    setAutoMatched(matched)
  }

  const confirmMatch = async (item, product) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('warehouse_invoice_items').update({ product_id: product.id, stato_match: 'abbinato' }).eq('id', item.id)
    // Auto-create alias
    if (item.nome_fattura && item.nome_fattura.toLowerCase() !== product.nome.toLowerCase()) {
      await supabase.from('warehouse_aliases').insert({ product_id: product.id, alias: item.nome_fattura, confermato: true })
    }
    setMatchingItem(null); setMatchSearch(''); setMatchResults([])
    if (expanded) await loadItems(expanded)
  }

  const deleteInvoice = async (id) => {
    await supabase.from('warehouse_invoice_items').delete().eq('invoice_id', id)
    await supabase.from('warehouse_invoices').delete().eq('id', id)
    setExpanded(null); await load()
  }

  return <>
    <Card title="Fatture" badge={invoices.length} extra={
      <button onClick={() => setShowForm(true)} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '5px 14px', fontWeight: 600, fontSize: 12 }}>+ Nuova fattura</button>
    }>
      {showForm && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid #2a3042' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <input type="date" value={form.data} onChange={e => setForm(p => ({ ...p, data: e.target.value }))} style={formS} />
          <input placeholder="Numero" value={form.numero} onChange={e => setForm(p => ({ ...p, numero: e.target.value }))} style={formS} />
          <input placeholder="Fornitore" value={form.fornitore} onChange={e => setForm(p => ({ ...p, fornitore: e.target.value }))} style={formS} />
          <input placeholder="Locale" value={form.locale} onChange={e => setForm(p => ({ ...p, locale: e.target.value }))} style={formS} />
          <input placeholder="Totale" type="number" step="0.01" value={form.totale} onChange={e => setForm(p => ({ ...p, totale: e.target.value }))} style={formS} />
          <select value={form.tipo_doc} onChange={e => setForm(p => ({ ...p, tipo_doc: e.target.value }))} style={formS}>
            <option value="fattura">Fattura</option>
            <option value="nota_credito">Nota di credito</option>
            <option value="ddt">DDT</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={saveInvoice} disabled={!form.data || !form.fornitore || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 16px', fontWeight: 600 }}>Salva</button>
          <button onClick={() => setShowForm(false)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '6px 12px' }}>Annulla</button>
        </div>
      </div>}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
          {['Data', 'Numero', 'Fornitore', 'Locale', 'Tipo', 'Totale', 'Stato', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {invoices.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center', padding: 20 }}>Nessuna fattura inserita</td></tr>}
          {invoices.map(inv => {
            const sc = STATUS_COLORS[inv.stato] || STATUS_COLORS.bozza
            return <tr key={inv.id} style={{ cursor: 'pointer', background: expanded === inv.id ? '#131825' : 'transparent' }} onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}>
              <td style={S.td}>{inv.data}</td>
              <td style={{ ...S.td, fontWeight: 500 }}>{inv.numero || '-'}</td>
              <td style={{ ...S.td, color: '#e2e8f0' }}>{inv.fornitore}</td>
              <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{inv.locale || '-'}</td>
              <td style={{ ...S.td, fontSize: 12 }}>{inv.tipo_doc}</td>
              <td style={{ ...S.td, fontWeight: 600 }}>{fmt(inv.totale)}</td>
              <td style={S.td}><span style={S.badge(sc.c, sc.bg)}>{inv.stato}</span></td>
              <td style={S.td}><button onClick={e => { e.stopPropagation(); if (confirm('Eliminare fattura?')) deleteInvoice(inv.id) }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>Elimina</button></td>
            </tr>
          })}
        </tbody>
      </table>
    </Card>

    {expanded && <div style={{ marginTop: 12 }}>
      <Card title="Righe fattura" badge={items.length} extra={
        <span style={{ fontSize: 11, color: '#64748b' }}>Fattura #{invoices.find(i => i.id === expanded)?.numero}</span>
      }>
        {/* Add item form */}
        <div style={{ background: '#131825', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #2a3042' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <input placeholder="Nome in fattura" value={itemForm.nome_fattura} onChange={e => setItemForm(p => ({ ...p, nome_fattura: e.target.value }))} style={formS} />
            <input placeholder="Qty" type="number" step="0.01" value={itemForm.quantita} onChange={e => setItemForm(p => ({ ...p, quantita: e.target.value }))} style={formS} />
            <input placeholder="Unita" value={itemForm.unita} onChange={e => setItemForm(p => ({ ...p, unita: e.target.value }))} style={formS} />
            <input placeholder="Prezzo unit." type="number" step="0.01" value={itemForm.prezzo_unitario} onChange={e => setItemForm(p => ({ ...p, prezzo_unitario: e.target.value }))} style={formS} />
            <input placeholder="Totale" type="number" step="0.01" value={itemForm.prezzo_totale} onChange={e => setItemForm(p => ({ ...p, prezzo_totale: e.target.value }))} style={formS} />
            <button onClick={addItem} disabled={!itemForm.nome_fattura || loading} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 600, marginBottom: 8 }}>+</button>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome fattura', 'Qty', 'Unita', 'Prezzo unit.', 'Totale', 'Stato', 'Prodotto', ''].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#475569', textAlign: 'center' }}>Nessuna riga</td></tr>}
            {items.map(it => (
              <tr key={it.id}>
                <td style={{ ...S.td, fontWeight: 500 }}>{it.nome_fattura}</td>
                <td style={S.td}>{it.quantita}</td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{it.unita}</td>
                <td style={S.td}>{fmt(it.prezzo_unitario)}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{fmt(it.prezzo_totale)}</td>
                <td style={S.td}>
                  <span style={S.badge(
                    it.stato_match === 'abbinato' ? '#10B981' : '#F59E0B',
                    it.stato_match === 'abbinato' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)'
                  )}>{it.stato_match === 'abbinato' ? 'Abbinato' : 'Non abbinato'}</span>
                </td>
                <td style={S.td}>
                  {it.stato_match === 'abbinato'
                    ? <span style={{ fontSize: 12, color: '#10B981' }}>{products.find(p => p.id === it.product_id)?.nome || 'Abbinato'}</span>
                    : autoMatched[it.id]
                      ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.12)')}>suggerito</span>
                          <span style={{ fontSize: 11, color: '#c4b5fd' }}>{products.find(p => p.id === autoMatched[it.id])?.nome}</span>
                          <button onClick={() => confirmMatch(it, products.find(p => p.id === autoMatched[it.id]))} style={{ ...iS, background: '#10B981', color: '#fff', border: 'none', padding: '2px 8px', fontWeight: 600, fontSize: 10 }}>Conferma</button>
                          <button onClick={() => { setMatchingItem(it); setMatchSearch(''); setMatchResults([]) }} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '2px 8px', fontSize: 10 }}>Altro</button>
                        </span>
                      : <button onClick={() => { setMatchingItem(it); setMatchSearch(''); setMatchResults([]) }} style={{ ...iS, background: '#F59E0B', color: '#0f1420', border: 'none', padding: '3px 10px', fontWeight: 600, fontSize: 11 }}>Abbina</button>
                  }
                </td>
                <td style={S.td}><button onClick={() => deleteItem(it.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }}>X</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Match modal */}
        {matchingItem && <div style={{ background: '#131825', borderRadius: 8, padding: 16, marginTop: 12, border: '1px solid #F59E0B' }}>
          <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 8 }}>Abbina "{matchingItem.nome_fattura}" a un prodotto:</div>
          <input placeholder="Cerca prodotto..." value={matchSearch} onChange={e => searchProducts(e.target.value)} style={{ ...formS, maxWidth: 300 }} autoFocus />
          {matchResults.map(p => (
            <div key={p.id} onClick={() => confirmMatch(matchingItem, p)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #2a3042', fontSize: 13, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 500 }}>{p.nome}</span>
              <span style={{ color: '#64748b', fontSize: 11 }}>({p.categoria} - {p.unita_misura})</span>
              {p.matchedVia === 'alias' && <span style={S.badge('#8B5CF6', 'rgba(139,92,246,.12)')}>alias</span>}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>score: {p.score.toFixed(0)}</span>
            </div>
          ))}
          <button onClick={() => setMatchingItem(null)} style={{ ...iS, color: '#64748b', border: '1px solid #2a3042', padding: '4px 12px', marginTop: 8, fontSize: 11 }}>Annulla</button>
        </div>}
      </Card>
    </div>}
  </>
}
