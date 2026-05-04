// Helper condivisi: tipi blocco + render HTML email-safe.
// Usato sia dal builder UI che dal sender (api/campaigns) per produrre HTML coerente.

export const BLOCK_TYPES = [
  { type: 'header',   label: 'Intestazione', icon: 'H' },
  { type: 'text',     label: 'Testo',        icon: '¶' },
  { type: 'image',    label: 'Immagine',     icon: '🖼' },
  { type: 'button',   label: 'Bottone',      icon: '▭' },
  { type: 'divider',  label: 'Divisore',     icon: '─' },
  { type: 'spacer',   label: 'Spaziatura',   icon: '↕' },
  { type: 'social',   label: 'Social',       icon: '☆' },
  { type: 'footer',   label: 'Footer',       icon: '_' },
]

export function defaultProps(type) {
  switch (type) {
    case 'header':  return { text: 'Titolo email', size: 28, color: '#111111', align: 'center', bold: true }
    case 'text':    return { html: 'Ciao {nome},\n\nScrivi qui il messaggio…', size: 14, color: '#374151', align: 'left' }
    case 'image':   return { src: '', alt: '', width: 600, link: '' }
    case 'button':  return { text: 'Scopri di più', url: 'https://', bg: '#F59E0B', color: '#0f1420', radius: 6, padding: 12 }
    case 'divider': return { color: '#e5e7eb', height: 1, margin: 12 }
    case 'spacer':  return { height: 24 }
    case 'social':  return { facebook: '', instagram: '', twitter: '', tripadvisor: '', google: '' }
    case 'footer':  return { html: 'Ricevi questa email perché sei nostro cliente.\nCancella iscrizione: {unsubscribe}', size: 11, color: '#94a3b8' }
    default: return {}
  }
}

function escHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderBlock(b) {
  const p = b.props || {}
  switch (b.type) {
    case 'header':
      return `<tr><td style="padding:${p.padding || 16}px 24px;text-align:${p.align || 'center'};">
        <h1 style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:${p.size || 28}px;color:${p.color || '#111'};font-weight:${p.bold ? 700 : 600};line-height:1.2;">${escHtml(p.text || '')}</h1>
      </td></tr>`

    case 'text': {
      const html = String(p.html || '').replace(/\n/g, '<br>')
      return `<tr><td style="padding:8px 24px;text-align:${p.align || 'left'};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:${p.size || 14}px;color:${p.color || '#374151'};line-height:1.6;">${html}</td></tr>`
    }

    case 'image': {
      if (!p.src) return ''
      const img = `<img src="${escHtml(p.src)}" alt="${escHtml(p.alt || '')}" width="${p.width || 600}" style="display:block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />`
      const inner = p.link ? `<a href="${escHtml(p.link)}" target="_blank" rel="noreferrer">${img}</a>` : img
      return `<tr><td style="padding:8px 24px;text-align:center;">${inner}</td></tr>`
    }

    case 'button':
      return `<tr><td style="padding:14px 24px;text-align:center;">
        <a href="${escHtml(p.url || '#')}" target="_blank" rel="noreferrer" style="display:inline-block;background:${p.bg || '#F59E0B'};color:${p.color || '#0f1420'};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;text-decoration:none;padding:${p.padding || 12}px 22px;border-radius:${p.radius != null ? p.radius : 6}px;">${escHtml(p.text || 'Click')}</a>
      </td></tr>`

    case 'divider':
      return `<tr><td style="padding:${p.margin || 12}px 24px;"><div style="border-top:${p.height || 1}px solid ${p.color || '#e5e7eb'};"></div></td></tr>`

    case 'spacer':
      return `<tr><td style="height:${p.height || 24}px;line-height:${p.height || 24}px;font-size:1px;">&nbsp;</td></tr>`

    case 'social': {
      const links = []
      if (p.facebook)    links.push(`<a href="${escHtml(p.facebook)}" target="_blank" style="margin:0 6px;color:#1877F2;text-decoration:none;font-weight:600;">Facebook</a>`)
      if (p.instagram)   links.push(`<a href="${escHtml(p.instagram)}" target="_blank" style="margin:0 6px;color:#E4405F;text-decoration:none;font-weight:600;">Instagram</a>`)
      if (p.twitter)     links.push(`<a href="${escHtml(p.twitter)}" target="_blank" style="margin:0 6px;color:#000;text-decoration:none;font-weight:600;">X</a>`)
      if (p.tripadvisor) links.push(`<a href="${escHtml(p.tripadvisor)}" target="_blank" style="margin:0 6px;color:#00AA6C;text-decoration:none;font-weight:600;">TripAdvisor</a>`)
      if (p.google)      links.push(`<a href="${escHtml(p.google)}" target="_blank" style="margin:0 6px;color:#4285F4;text-decoration:none;font-weight:600;">Google</a>`)
      if (links.length === 0) return ''
      return `<tr><td style="padding:14px 24px;text-align:center;font-size:13px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">${links.join(' · ')}</td></tr>`
    }

    case 'footer': {
      const html = String(p.html || '').replace(/\n/g, '<br>')
      return `<tr><td style="padding:18px 24px 24px;text-align:center;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:${p.size || 11}px;color:${p.color || '#94a3b8'};line-height:1.6;">${html}</td></tr>`
    }

    default: return ''
  }
}

// Renderizza i blocchi in HTML completo (table-based, email-safe).
export function renderBlocksToHtml(blocks, meta = {}) {
  const bg = meta.bg_color || '#f5f5f5'
  const cardBg = meta.card_bg || '#ffffff'
  const width = meta.content_width || 600
  const inner = (blocks || []).map(renderBlock).join('')
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email</title></head>
<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;background:${cardBg};border-radius:8px;overflow:hidden;">
      ${inner}
    </table>
  </td></tr>
</table>
</body></html>`
}
