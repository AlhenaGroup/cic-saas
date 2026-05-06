import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { S, Card, fmtD } from '../shared/styles.jsx'
import { costOfManualArticle, toBaseUnit } from '../../lib/manualArticles.js'

const iS = S.input
const UM_OPTS = ['KG', 'LT', 'PZ']
const ING_UM_OPTS = ['KG', 'g', 'LT', 'cl', 'ml', 'PZ']

// Costruisce la mappa prezzo medio per articoli del magazzino:
//   nome (lower) { perUnit (€/UM_base), baseUm }
function buildArticlesPriceMap(items) {
  const map = {}
  ;(items || []).forEach(it => {
    if (it.escludi_magazzino || !it.nome_articolo) return
    const qFatt = Number(it.quantita) || 0
    const qTipo = Number(it.totale_um) || 0
    const qSing = Number(it.qty_singola) || 0
    const tot = qFatt * qTipo * qSing
    const spesa = Math.abs(Number(it.prezzo_totale) || 0)
    if (tot <= 0 || spesa <= 0) return
    const perUnit = spesa / tot
    const baseUm = (it.unita || 'PZ').toUpperCase()
    const key = it.nome_articolo.trim().toLowerCase()
    if (!map[key]) map[key] = { sums: 0, count: 0, baseUm }
    map[key].sums += perUnit
    map[key].count++
  })
  const out = {}
  for (const k in map) {
    out[k] = { perUnit: map[k].sums / map[k].count, baseUm: map[k].baseUm }
  }
  return out
}

export default function ManualArticlesManager({ sp, sps }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | 'new' | id
  const [articlesPrice, setArticlesPrice] = useState({})
  const [allArticleNames, setAllArticleNames] = useState([])

  const localeName = sp === 'all' ? null : sps?.find(s => String(s.id) === String(sp))?.description || sps?.find(s => String(s.id) === String(sp))?.name || null

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: rows }, { data: items }] = await Promise.all([
      supabase.from('manual_articles').select('*').order('nome'),
      supabase.from('warehouse_invoice_items').select('nome_articolo,unita,quantita,qty_singola,totale_um,prezzo_totale,escludi_magazzino').not('nome_articolo', 'is', null),
    ])
    setList(rows || [])
    const priceMap = buildArticlesPriceMap(items || [])
    setArticlesPrice(priceMap)
    // Lista nomi unici per autocomplete
    const names = new Set()
    ;(items || []).forEach(it => { if (it.nome_articolo && !it.escludi_magazzino) names.add(it.nome_articolo.trim()) })
    ;(rows || []).forEach(r => names.add(r.nome))
    setAllArticleNames([...names].sort((a, b) => a.localeCompare(b)))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const manualByName = useMemo(() => {
    const m = {}
    list.forEach(a => { m[a.nome.trim().toLowerCase()] = a })
    return m
  }, [list])

  const filtered = localeName ? list.filter(a => !a.locale || a.locale === localeName) : list

  const remove = async (id) => {
    if (!confirm('Eliminare questo semilavorato? Le ricette che lo usano avranno food cost = 0 per quell\'ingrediente.')) return
    await supabase.from('manual_articles').delete().eq('id', id)
    await load()
  }

  const approva = async (id) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('manual_articles').update({
      approved: true, approved_by: user.id, approved_at: new Date().toISOString(),
    }).eq('id', id)
    await load()
  }

  return <Card title="Semilavorati" badge={loading ? '...' : filtered.length + ' voci'} extra={
    <button onClick={() => setEditing('new')}
      style={{ ...iS, background: '#10B981', color: '#0f1420', fontWeight: 700, border: 'none', padding: '5px 14px', fontSize: 11, cursor: 'pointer' }}>
      + Aggiungi semilavorato
    </button>
  }>
    {loading ? (
      <div style={{ padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Caricamento...</div>
    ) : filtered.length === 0 ? (
      <div style={{ padding: 20, textAlign: 'center', color: '#475569', fontSize: 13 }}>
        Nessun semilavorato. Aggiungi salse, basi, impasti che produci internamente — verranno usati come ingredienti nelle ricette.
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: '1px solid #2a3042' }}>
            {['Nome', 'Resa', 'N° ingredienti', 'Costo totale', 'Costo /UM', 'Locale', ''].map(h =>
              <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map(a => {
              const c = costOfManualArticle(a, articlesPrice, manualByName)
              return <tr key={a.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  {a.nome}
                  {a.approved === false && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#F59E0B', marginTop: 2 }}>
                      Da confermare {a.created_by_employee_name ? `· da ${a.created_by_employee_name}` : ''}
                    </div>
                  )}
                </td>
                <td style={{ ...S.td, color: '#94a3b8' }}>{Number(a.resa).toFixed(3)} {a.unita}</td>
                <td style={{ ...S.td, color: '#94a3b8', textAlign: 'center' }}>{(a.ingredienti || []).length}</td>
                <td style={{ ...S.td, color: '#F59E0B' }}>{fmtD(c.totalCost)}</td>
                <td style={{ ...S.td, fontWeight: 600, color: c.missing.length ? '#EF4444' : '#10B981' }}>
                  {c.perUnit > 0 ? fmtD(c.perUnit) + '/' + c.baseUm : '—'}
                  {c.missing.length > 0 && <span title={'Ingredienti senza prezzo: ' + c.missing.join(', ')} style={{ marginLeft: 4 }}></span>}
                </td>
                <td style={{ ...S.td, fontSize: 11, color: '#94a3b8' }}>{a.locale || '—'}</td>
                <td style={S.td}>
                  {a.approved === false && (
                    <button onClick={() => approva(a.id)} title="Conferma semilavorato creato da staff"
                      style={{ background: '#10B981', color: '#0f1420', border: 'none', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', marginRight: 4 }}>
                      Approva
                    </button>
                  )}
                  <button onClick={() => setEditing(a.id)} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 11, marginRight: 6 }}>Modifica</button>
                  <button onClick={() => remove(a.id)} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}>Elimina</button>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )}
    {editing && <ArticleForm
      article={editing === 'new' ? null : list.find(a => a.id === editing)}
      allArticleNames={allArticleNames}
      articlesPrice={articlesPrice}
      manualByName={manualByName}
      sps={sps}
      defaultLocale={localeName}
      onClose={() => setEditing(null)}
      onSaved={async () => { setEditing(null); await load() }}
    />}
  </Card>
}

function ArticleForm({ article, allArticleNames, articlesPrice, manualByName, sps, defaultLocale, onClose, onSaved }) {
  const [nome, setNome] = useState(article?.nome || '')
  const [unita, setUnita] = useState(article?.unita || 'KG')
  const [resa, setResa] = useState(article?.resa || '1')
  const [locale, setLocale] = useState(article?.locale || defaultLocale || '')
  const [note, setNote] = useState(article?.note || '')
  const [ingr, setIngr] = useState(article?.ingredienti || [{ nome_articolo: '', quantita: '', unita: 'KG' }])
  const [saving, setSaving] = useState(false)

  const addIngr = () => setIngr(prev => [...prev, { nome_articolo: '', quantita: '', unita: 'KG' }])
  const removeIngr = (i) => setIngr(prev => prev.filter((_, idx) => idx !== i))
  const updateIngr = (i, key, val) => setIngr(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: val } : it))

  // Preview costo durante la modifica
  const preview = (() => {
    const fakeArt = { unita, resa: Number(resa) || 1, ingredienti: ingr.filter(i => i.nome_articolo && Number(i.quantita) > 0) }
    return costOfManualArticle(fakeArt, articlesPrice, manualByName)
  })()

  const submit = async () => {
    if (!nome.trim()) { alert('Nome obbligatorio'); return }
    if (!Number(resa) || Number(resa) <= 0) { alert('Resa deve essere > 0'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { alert('Sessione scaduta'); setSaving(false); return }
    const ingPulito = ingr
      .filter(i => i.nome_articolo && Number(i.quantita) > 0)
      .map(i => ({ nome_articolo: i.nome_articolo.trim(), quantita: Number(i.quantita), unita: i.unita || 'KG' }))
    const payload = {
      user_id: user.id,
      nome: nome.trim(),
      unita,
      resa: Number(resa),
      ingredienti: ingPulito,
      locale: locale || null,
      note: note || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = article
      ? await supabase.from('manual_articles').update(payload).eq('id', article.id)
      : await supabase.from('manual_articles').insert(payload)
    setSaving(false)
    if (error) { alert('Errore: ' + error.message); return }
    onSaved()
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflow: 'auto', padding: 24 }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 720 }}>
      <div style={{ padding: 18, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{article ? 'Modifica semilavorato' : '+ Nuovo semilavorato'}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Nome (es. Salsa Remembeer, Cipolla Caramellata)">
          <input value={nome} onChange={e => setNome(e.target.value)} style={{ ...iS, width: '100%' }} placeholder="Salsa Remembeer" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10 }}>
          <Field label="UM finale">
            <select value={unita} onChange={e => setUnita(e.target.value)} style={{ ...iS, width: '100%' }}>
              {UM_OPTS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Resa (quanto produce)">
            <input type="number" step="0.001" value={resa} onChange={e => setResa(e.target.value)} style={{ ...iS, width: '100%' }} />
          </Field>
          <Field label="Locale (opz., lascia vuoto se condiviso)">
            <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...iS, width: '100%' }}>
              <option value="">— condiviso —</option>
              {(sps || []).map(s => <option key={s.id} value={s.description || s.name}>{s.description || s.name}</option>)}
            </select>
          </Field>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Ingredienti ({ingr.length})
          </div>
          {ingr.map((it, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 32px', gap: 6, marginBottom: 6 }}>
              <input list="manual-ing-list" value={it.nome_articolo}
                onChange={e => updateIngr(i, 'nome_articolo', e.target.value)}
                placeholder="Articolo o altro semilavorato..."
                style={{ ...iS, fontSize: 12 }} />
              <input type="number" step="0.001" value={it.quantita}
                onChange={e => updateIngr(i, 'quantita', e.target.value)}
                placeholder="Qty"
                style={{ ...iS, fontSize: 12, textAlign: 'center' }} />
              <select value={it.unita} onChange={e => updateIngr(i, 'unita', e.target.value)} style={{ ...iS, fontSize: 12 }}>
                {ING_UM_OPTS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <button onClick={() => removeIngr(i)} style={{ background: 'none', border: 'none', color: '#EF4444', fontSize: 14, cursor: 'pointer' }}>×</button>
            </div>
          ))}
          <datalist id="manual-ing-list">
            {allArticleNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <button onClick={addIngr} style={{ ...iS, background: '#3B82F6', color: '#fff', border: 'none', padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>+ Ingrediente</button>
        </div>

        {/* Preview costo */}
        <div style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>Anteprima costo</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: preview.missing.length ? '#EF4444' : '#10B981' }}>
            {preview.perUnit > 0 ? fmtD(preview.perUnit) + '/' + preview.baseUm : '—'}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
            Totale ingredienti: {fmtD(preview.totalCost || 0)} · Resa: {Number(resa || 1).toFixed(3)} {unita}
          </div>
          {preview.missing.length > 0 && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>
            Ingredienti senza prezzo: {preview.missing.join(', ')}
          </div>}
        </div>

        <Field label="Note (opz.)">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...iS, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
      </div>
      <div style={{ padding: 14, borderTop: '1px solid #2a3042', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} disabled={saving} style={{ ...iS, color: '#94a3b8', border: '1px solid #2a3042', padding: '7px 14px', cursor: 'pointer' }}>Annulla</button>
        <button onClick={submit} disabled={saving}
          style={{ ...iS, background: '#F59E0B', color: '#0f1420', fontWeight: 700, border: 'none', padding: '7px 18px', cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Salvo...' : 'Salva'}
        </button>
      </div>
    </div>
  </div>
}

function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</span>
    {children}
  </div>
}
