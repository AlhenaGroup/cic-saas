// Email Builder block-based.
// Lista blocchi a sinistra (drag/click per aggiungere), preview centrale, ispettore proprietà a destra.
// I blocchi vengono renderizzati in HTML email-safe via renderBlocksToHtml.

import { useState, useMemo } from 'react'
import { S } from '../shared/styles'
import { BLOCK_TYPES, defaultProps, renderBlocksToHtml } from '../../lib/emailBlocks'

export default function EmailBuilder({ blocks, meta, onChange }) {
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('design')  // design | html

  const html = useMemo(() => renderBlocksToHtml(blocks || [], meta || {}), [blocks, meta])

  const addBlock = (type) => {
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const newBlocks = [...(blocks || []), { id, type, props: defaultProps(type) }]
    onChange({ blocks: newBlocks, meta })
    setSelected(id)
  }

  const updateBlock = (id, patch) => {
    const newBlocks = (blocks || []).map(b => b.id === id ? { ...b, props: { ...b.props, ...patch } } : b)
    onChange({ blocks: newBlocks, meta })
  }

  const moveBlock = (id, dir) => {
    const arr = [...(blocks || [])]
    const idx = arr.findIndex(b => b.id === id)
    if (idx < 0) return
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[ni]; arr[ni] = tmp
    onChange({ blocks: arr, meta })
  }

  const deleteBlock = (id) => {
    onChange({ blocks: (blocks || []).filter(b => b.id !== id), meta })
    if (selected === id) setSelected(null)
  }

  const updateMeta = (patch) => onChange({ blocks, meta: { ...meta, ...patch } })

  const selBlock = (blocks || []).find(b => b.id === selected)

  return <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 280px', gap: 12, height: '70vh' }}>
    {/* Palette blocks */}
    <div style={paneStyle}>
      <div style={paneTitle}>Aggiungi blocco</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {BLOCK_TYPES.map(b => (
          <button key={b.type} onClick={() => addBlock(b.type)} style={paletteBtn}>
            <span style={{ width: 22, fontSize: 13 }}>{b.icon}</span>
            <span>{b.label}</span>
          </button>
        ))}
      </div>

      <div style={{ ...paneTitle, marginTop: 14 }}>Aspetto</div>
      <Field label="Sfondo email"><input type="color" value={meta?.bg_color || '#f5f5f5'} onChange={e => updateMeta({ bg_color: e.target.value })} style={colorInput} /></Field>
      <Field label="Sfondo card"><input type="color" value={meta?.card_bg || '#ffffff'} onChange={e => updateMeta({ card_bg: e.target.value })} style={colorInput} /></Field>
      <Field label="Larghezza (px)"><input type="number" min="320" max="800" value={meta?.content_width || 600} onChange={e => updateMeta({ content_width: Number(e.target.value || 600) })} style={S.input} /></Field>
    </div>

    {/* Preview canvas */}
    <div style={{ ...paneStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #2a3042' }}>
        <button onClick={() => setTab('design')} style={tabBtn(tab === 'design')}>Design</button>
        <button onClick={() => setTab('html')} style={tabBtn(tab === 'html')}>HTML</button>
      </div>
      {tab === 'design' && <div style={{ flex: 1, overflowY: 'auto', background: meta?.bg_color || '#f5f5f5' }}>
        <div style={{ width: meta?.content_width || 600, maxWidth: '100%', margin: '20px auto', background: meta?.card_bg || '#fff', borderRadius: 8, overflow: 'hidden' }}>
          {(blocks || []).length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Aggiungi blocchi dalla palette a sinistra
          </div>}
          {(blocks || []).map((b, i) => (
            <BlockPreview key={b.id} block={b}
              selected={b.id === selected}
              onClick={() => setSelected(b.id)}
              onMoveUp={i > 0 ? () => moveBlock(b.id, -1) : null}
              onMoveDown={i < blocks.length - 1 ? () => moveBlock(b.id, 1) : null}
              onDelete={() => deleteBlock(b.id)}
            />
          ))}
        </div>
      </div>}
      {tab === 'html' && <textarea readOnly value={html} style={{ flex: 1, padding: 12, background: '#0f1420', color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11, border: 'none', resize: 'none' }} />}
    </div>

    {/* Inspector */}
    <div style={paneStyle}>
      <div style={paneTitle}>Proprietà blocco</div>
      {!selBlock && <div style={{ fontSize: 12, color: '#64748b' }}>Seleziona un blocco per modificarlo.</div>}
      {selBlock && <BlockEditor block={selBlock} onChange={(patch) => updateBlock(selBlock.id, patch)} />}
    </div>
  </div>
}

// ─── Preview di un blocco con overlay click/move/delete ─────────────
function BlockPreview({ block, selected, onClick, onMoveUp, onMoveDown, onDelete }) {
  return <div onClick={onClick} style={{
    position: 'relative',
    border: selected ? '2px solid #F59E0B' : '2px solid transparent',
    cursor: 'pointer',
  }}>
    {/* render dei singoli blocchi è approssimato qui (no tabella nidificata, solo visual) */}
    <BlockVisual block={block} />
    {selected && <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4, background: '#1a1f2e', padding: 3, borderRadius: 6 }}>
      {onMoveUp && <button onClick={(e) => { e.stopPropagation(); onMoveUp() }} style={iconBtn}>↑</button>}
      {onMoveDown && <button onClick={(e) => { e.stopPropagation(); onMoveDown() }} style={iconBtn}>↓</button>}
      <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{ ...iconBtn, color: '#EF4444' }}>×</button>
    </div>}
  </div>
}

function BlockVisual({ block }) {
  const p = block.props || {}
  switch (block.type) {
    case 'header':
      return <div style={{ padding: '16px 24px', textAlign: p.align || 'center', fontSize: p.size || 28, color: p.color || '#111', fontWeight: p.bold ? 700 : 600, lineHeight: 1.2 }}>{p.text || 'Titolo'}</div>
    case 'text':
      return <div style={{ padding: '8px 24px', textAlign: p.align || 'left', fontSize: p.size || 14, color: p.color || '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.html || ''}</div>
    case 'image':
      return <div style={{ padding: '8px 24px', textAlign: 'center' }}>
        {p.src ? <img src={p.src} alt={p.alt || ''} style={{ maxWidth: '100%', display: 'block', margin: '0 auto', maxHeight: 300 }} />
          : <div style={{ background: '#e5e7eb', padding: 30, color: '#64748b', fontSize: 12 }}>📷 immagine vuota — imposta URL</div>}
      </div>
    case 'button':
      return <div style={{ padding: '14px 24px', textAlign: 'center' }}>
        <span style={{ display: 'inline-block', background: p.bg || '#F59E0B', color: p.color || '#0f1420', fontWeight: 600, fontSize: 14, padding: `${p.padding || 12}px 22px`, borderRadius: p.radius != null ? p.radius : 6 }}>{p.text || 'Click'}</span>
      </div>
    case 'divider':
      return <div style={{ padding: `${p.margin || 12}px 24px` }}><div style={{ borderTop: `${p.height || 1}px solid ${p.color || '#e5e7eb'}` }} /></div>
    case 'spacer':
      return <div style={{ height: p.height || 24 }} />
    case 'social':
      return <div style={{ padding: '14px 24px', textAlign: 'center', fontSize: 13, color: '#374151' }}>
        {[p.facebook && 'Facebook', p.instagram && 'Instagram', p.twitter && 'X', p.tripadvisor && 'TripAdvisor', p.google && 'Google'].filter(Boolean).join(' · ') || <span style={{ color: '#94a3b8' }}>Aggiungi link social</span>}
      </div>
    case 'footer':
      return <div style={{ padding: '18px 24px 24px', textAlign: 'center', fontSize: p.size || 11, color: p.color || '#94a3b8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.html || ''}</div>
    default: return null
  }
}

// ─── Editor proprietà del blocco selezionato ─────────────────────────
function BlockEditor({ block, onChange }) {
  const p = block.props || {}
  switch (block.type) {
    case 'header': return <>
      <Field label="Testo"><input value={p.text || ''} onChange={e => onChange({ text: e.target.value })} style={S.input} /></Field>
      <div style={twoCol}>
        <Field label="Dimensione (px)"><input type="number" value={p.size || 28} onChange={e => onChange({ size: Number(e.target.value || 28) })} style={S.input} /></Field>
        <Field label="Colore"><input type="color" value={p.color || '#111111'} onChange={e => onChange({ color: e.target.value })} style={colorInput} /></Field>
      </div>
      <Field label="Allineamento"><AlignButtons value={p.align} onChange={(v) => onChange({ align: v })} /></Field>
      <label style={chk}><input type="checkbox" checked={!!p.bold} onChange={e => onChange({ bold: e.target.checked })} /> Grassetto</label>
    </>
    case 'text': return <>
      <Field label="Contenuto · supporta {nome} {cognome} {locale}">
        <textarea value={p.html || ''} onChange={e => onChange({ html: e.target.value })} style={{ ...S.input, minHeight: 110, fontFamily: 'inherit' }} />
      </Field>
      <div style={twoCol}>
        <Field label="Size (px)"><input type="number" value={p.size || 14} onChange={e => onChange({ size: Number(e.target.value || 14) })} style={S.input} /></Field>
        <Field label="Colore"><input type="color" value={p.color || '#374151'} onChange={e => onChange({ color: e.target.value })} style={colorInput} /></Field>
      </div>
      <Field label="Allineamento"><AlignButtons value={p.align} onChange={(v) => onChange({ align: v })} /></Field>
    </>
    case 'image': return <>
      <Field label="URL immagine"><input value={p.src || ''} onChange={e => onChange({ src: e.target.value })} placeholder="https://..." style={S.input} /></Field>
      <Field label="Alt text"><input value={p.alt || ''} onChange={e => onChange({ alt: e.target.value })} style={S.input} /></Field>
      <div style={twoCol}>
        <Field label="Larghezza"><input type="number" value={p.width || 600} onChange={e => onChange({ width: Number(e.target.value || 600) })} style={S.input} /></Field>
        <Field label="Link click (opz)"><input value={p.link || ''} onChange={e => onChange({ link: e.target.value })} style={S.input} /></Field>
      </div>
    </>
    case 'button': return <>
      <Field label="Testo"><input value={p.text || ''} onChange={e => onChange({ text: e.target.value })} style={S.input} /></Field>
      <Field label="URL"><input value={p.url || ''} onChange={e => onChange({ url: e.target.value })} placeholder="https://..." style={S.input} /></Field>
      <div style={twoCol}>
        <Field label="Sfondo"><input type="color" value={p.bg || '#F59E0B'} onChange={e => onChange({ bg: e.target.value })} style={colorInput} /></Field>
        <Field label="Colore testo"><input type="color" value={p.color || '#0f1420'} onChange={e => onChange({ color: e.target.value })} style={colorInput} /></Field>
      </div>
      <div style={twoCol}>
        <Field label="Border radius"><input type="number" value={p.radius != null ? p.radius : 6} onChange={e => onChange({ radius: Number(e.target.value || 0) })} style={S.input} /></Field>
        <Field label="Padding"><input type="number" value={p.padding || 12} onChange={e => onChange({ padding: Number(e.target.value || 12) })} style={S.input} /></Field>
      </div>
    </>
    case 'divider': return <>
      <Field label="Colore"><input type="color" value={p.color || '#e5e7eb'} onChange={e => onChange({ color: e.target.value })} style={colorInput} /></Field>
      <div style={twoCol}>
        <Field label="Spessore"><input type="number" value={p.height || 1} onChange={e => onChange({ height: Number(e.target.value || 1) })} style={S.input} /></Field>
        <Field label="Margine vert."><input type="number" value={p.margin || 12} onChange={e => onChange({ margin: Number(e.target.value || 12) })} style={S.input} /></Field>
      </div>
    </>
    case 'spacer': return <Field label="Altezza (px)"><input type="number" value={p.height || 24} onChange={e => onChange({ height: Number(e.target.value || 24) })} style={S.input} /></Field>
    case 'social': return <>
      <Field label="Facebook"><input value={p.facebook || ''} onChange={e => onChange({ facebook: e.target.value })} style={S.input} /></Field>
      <Field label="Instagram"><input value={p.instagram || ''} onChange={e => onChange({ instagram: e.target.value })} style={S.input} /></Field>
      <Field label="X / Twitter"><input value={p.twitter || ''} onChange={e => onChange({ twitter: e.target.value })} style={S.input} /></Field>
      <Field label="TripAdvisor"><input value={p.tripadvisor || ''} onChange={e => onChange({ tripadvisor: e.target.value })} style={S.input} /></Field>
      <Field label="Google"><input value={p.google || ''} onChange={e => onChange({ google: e.target.value })} style={S.input} /></Field>
    </>
    case 'footer': return <>
      <Field label="Testo footer"><textarea value={p.html || ''} onChange={e => onChange({ html: e.target.value })} style={{ ...S.input, minHeight: 80, fontFamily: 'inherit' }} /></Field>
      <div style={twoCol}>
        <Field label="Size"><input type="number" value={p.size || 11} onChange={e => onChange({ size: Number(e.target.value || 11) })} style={S.input} /></Field>
        <Field label="Colore"><input type="color" value={p.color || '#94a3b8'} onChange={e => onChange({ color: e.target.value })} style={colorInput} /></Field>
      </div>
    </>
    default: return null
  }
}

function AlignButtons({ value, onChange }) {
  return <div style={{ display: 'flex', gap: 4 }}>
    {['left', 'center', 'right'].map(a => (
      <button key={a} onClick={() => onChange(a)} style={{
        flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600,
        background: value === a ? '#F59E0B' : '#0f1420', color: value === a ? '#0f1420' : '#cbd5e1',
        border: '1px solid ' + (value === a ? '#F59E0B' : '#2a3042'), borderRadius: 5, cursor: 'pointer',
      }}>{a === 'left' ? '⬅' : a === 'center' ? '⬌' : '➡'}</button>
    ))}
  </div>
}

// ─── styles ──────────────────────────────────────────────────────────
const paneStyle = { background: '#1a1f2e', border: '1px solid #2a3042', borderRadius: 8, padding: 12, overflowY: 'auto' }
const paneTitle = { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, fontWeight: 700 }
const paletteBtn = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', fontSize: 12, background: '#0f1420', color: '#cbd5e1', border: '1px solid #2a3042', borderRadius: 5, cursor: 'pointer', textAlign: 'left' }
const colorInput = { width: '100%', height: 30, padding: 0, background: 'transparent', border: '1px solid #2a3042', borderRadius: 4, cursor: 'pointer' }
const iconBtn = { width: 24, height: 24, padding: 0, fontSize: 14, background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer' }
const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }
const chk = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1', marginTop: 8 }

function Field({ label, children }) {
  return <label style={{ display: 'block', marginTop: 8 }}>
    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    {children}
  </label>
}

function tabBtn(active) {
  return { flex: 1, padding: '10px 14px', background: active ? '#0f1420' : 'transparent', color: active ? '#F59E0B' : '#94a3b8', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, borderBottom: active ? '2px solid #F59E0B' : '2px solid transparent' }
}
