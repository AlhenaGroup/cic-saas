// Modal dettaglio comanda/scontrino
// Mostra tutti i campi disponibili dalla riga scontrino + items + bottone stampa

import { S } from './shared/styles.jsx'
import { fmt, fmtD } from './shared/styles.jsx'

export default function ReceiptDetailModal({ receipt, onClose }) {
  if (!receipt) return null

  const items = receipt.itemsList || []
  const totItems = items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
  const subtotale = items.reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.prezzo) || 0)), 0)

  // Ricavo da raw extra info se disponibile
  const raw = receipt.rawReceipt || {}
  const sconto = receipt.sconto || raw.sconto || raw.discountAmount
  const promozioni = receipt.promozioni || raw.promozioni
  const cassiere = receipt.cassiere || raw.cassiere || raw.user || raw.username
  const metodoPag = receipt.payment !== '—' ? receipt.payment : (raw.metodoPagamento || raw.paymentMethod)

  const printReceipt = () => {
    const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const w = window.open('', '_blank')
    if (!w) { alert('Popup bloccato — abilita i popup per stampare.'); return }
    let html = `<!DOCTYPE html><html><head><title>${escHtml(receipt.id)} - ${escHtml(receipt.date)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Courier New', monospace; font-size: 12px; padding: 0; margin: 0; color: #000; }
  .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
  .header h1 { margin: 0; font-size: 14px; font-weight: 700; }
  .info { font-size: 11px; margin-bottom: 8px; }
  .info div { display: flex; justify-content: space-between; padding: 1px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; border-bottom: 1px solid #000; padding: 4px 0; }
  th.right, td.right { text-align: right; }
  td { padding: 3px 0; vertical-align: top; }
  tr.item td { border-bottom: 1px dashed #ccc; }
  tfoot td { border-top: 1px solid #000; padding-top: 6px; font-weight: 700; }
  tfoot .total { font-size: 14px; }
  .footer { text-align: center; font-size: 10px; margin-top: 12px; color: #555; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <h1>${escHtml(receipt.locale || '')}</h1>
  <div>${escHtml(receipt.id)} · ${escHtml(receipt.date)}</div>
</div>
<div class="info">
  ${receipt.time ? `<div><span>Apertura</span><span>${escHtml(receipt.time)}</span></div>` : ''}
  ${receipt.chiusura ? `<div><span>Chiusura</span><span>${escHtml(receipt.chiusura)}</span></div>` : ''}
  ${receipt.tavolo ? `<div><span>Tavolo</span><span>${escHtml(receipt.tavolo)}</span></div>` : ''}
  ${receipt.coperti ? `<div><span>Coperti</span><span>${escHtml(receipt.coperti)}</span></div>` : ''}
  ${cassiere ? `<div><span>Cassiere</span><span>${escHtml(cassiere)}</span></div>` : ''}
</div>
<table>
  <thead><tr>
    <th>Prodotto</th>
    <th class="right">Qtà</th>
    <th class="right">Prezzo</th>
    <th class="right">Tot.</th>
  </tr></thead>
  <tbody>
    ${items.map(it => `<tr class="item">
      <td>${escHtml(it.nome || '')}${it.reparto ? `<br><small style="color:#666">${escHtml(it.reparto)}</small>` : ''}</td>
      <td class="right">${escHtml(it.qty || 1)}</td>
      <td class="right">${fmt(it.prezzo || 0)}</td>
      <td class="right">${fmt((Number(it.qty) || 1) * (Number(it.prezzo) || 0))}</td>
    </tr>`).join('')}
  </tbody>
  <tfoot>
    ${sconto ? `<tr><td colspan="3">Sconto</td><td class="right">-${fmt(sconto)}</td></tr>` : ''}
    <tr class="total"><td colspan="3">TOTALE</td><td class="right">${fmt(receipt.total || 0)}</td></tr>
    ${metodoPag && metodoPag !== '—' ? `<tr><td colspan="4" style="text-align:center;font-weight:400;border:none;padding-top:6px">Pagamento: ${escHtml(metodoPag)}</td></tr>` : ''}
  </tfoot>
</table>
<div class="footer">
  Documento non fiscale · Riepilogo comanda
</div>
</body></html>`
    w.document.write(html); w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 300)
  }

  return <div className="m-modal-fullscreen" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, padding: 24, overflow: 'auto' }}>
    <div style={{ background: '#0f1420', border: '1px solid #2a3042', borderRadius: 12, width: '100%', maxWidth: 640 }}>
      <div style={{ padding: 16, borderBottom: '1px solid #2a3042', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {receipt.isInvoice && <span style={{ ...S.badge('#8B5CF6','rgba(139,92,246,.15)'), marginRight: 8 }}>FATT</span>}
            {receipt.id}
          </h3>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {receipt.date} · {receipt.locale}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <div style={{ padding: 20 }}>
        {/* Header info */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 14 }}>
          <Cell label="Apertura comanda" value={receipt.time || '—'} color="#10B981" />
          <Cell label="Chiusura / pagamento" value={receipt.chiusura || '—'} color="#94a3b8" />
          <Cell label="Tavolo" value={receipt.tavolo || '—'} color="#F59E0B" />
          <Cell label="Coperti" value={receipt.coperti || '—'} />
          {cassiere && <Cell label="Cassiere" value={cassiere} />}
          {metodoPag && metodoPag !== '—' && <Cell label="Pagamento" value={metodoPag} color="#3B82F6" />}
        </div>

        {/* Items */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            Articoli ({items.length} righe · {totItems} pezzi)
          </div>
          {items.length === 0 ? (
            <div style={{ padding: 14, color: '#64748b', textAlign: 'center', fontSize: 12, border: '1px dashed #2a3042', borderRadius: 8 }}>
              Dettaglio articoli non disponibile per questa comanda.
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #2a3042', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#131825' }}>
                  <tr style={{ borderBottom: '1px solid #2a3042' }}>
                    <th style={{ ...S.th, fontSize: 10, textAlign: 'left' }}>Prodotto</th>
                    <th style={{ ...S.th, fontSize: 10, textAlign: 'right' }}>Qtà</th>
                    <th style={{ ...S.th, fontSize: 10, textAlign: 'right' }}>Prezzo</th>
                    <th style={{ ...S.th, fontSize: 10, textAlign: 'right' }}>Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const tot = (Number(it.qty) || 1) * (Number(it.prezzo) || 0)
                    return <tr key={idx} style={{ borderBottom: '1px solid #1a1f2e' }}>
                      <td style={{ ...S.td, fontWeight: 500 }}>
                        {it.nome || it.description || '—'}
                        {it.reparto && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{it.reparto}{it.categoria ? ' · ' + it.categoria : ''}</div>}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', color: '#94a3b8' }}>{it.qty || 1}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>{fmt(it.prezzo || 0)}</td>
                      <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{fmt(tot)}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Totali */}
        <div style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#94a3b8' }}>
            <span>Subtotale articoli</span><span>{fmtD(subtotale)}</span>
          </div>
          {sconto && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#10B981' }}>
            <span>Sconto</span><span>-{fmtD(sconto)}</span>
          </div>}
          {promozioni && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: '#94a3b8' }}>
            <span>Promozioni</span><span>{Array.isArray(promozioni) ? promozioni.length : promozioni}</span>
          </div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700, color: receipt.isInvoice ? '#8B5CF6' : '#F59E0B', borderTop: '1px solid #2a3042', paddingTop: 10, marginTop: 6 }}>
            <span>TOTALE</span><span>{fmtD(receipt.total || 0)}</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #2a3042' }}>
          <button onClick={onClose} style={{ ...S.input, padding: '8px 16px', cursor: 'pointer' }}>Chiudi</button>
          <button onClick={printReceipt}
            style={{ ...S.input, background: '#3B82F6', color: '#fff', border: 'none', padding: '8px 18px', fontWeight: 700, cursor: 'pointer' }}>
            Stampa scontrino
          </button>
        </div>
      </div>
    </div>
  </div>
}

function Cell({ label, value, color = '#e2e8f0' }) {
  return <div style={{ background: '#131825', border: '1px solid #2a3042', borderRadius: 8, padding: 10 }}>
    <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color }}>{value}</div>
  </div>
}
