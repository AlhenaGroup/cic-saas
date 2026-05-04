import { GoogleAuth } from 'google-auth-library';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';

// Google Sheets config
const SHEETS = {
  'REMEMBEER': '15T4oh553HBUZxJ_YmMacQQAGtzSD-s6SIc_gUWsmlxk',
  'CASA DE AMICIS': '1SOcNEQgQ7SgpYBHtvcSb0OpIIrKU5fr9g9DomcdQAc4'
};

const GOOGLE_CREDS = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : {
  client_email: 'cic-sheets@cic-saas-proxy.iam.gserviceaccount.com',
  private_key: process.env.GOOGLE_PRIVATE_KEY || ''
};

// Serializza una risposta checklist per la riga Google Sheet
function formatAnswer(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'SI' : 'NO';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

async function appendToSheet(locale, row, range = 'A:F') {
  const sheetId = SHEETS[locale];
  if (!sheetId || !GOOGLE_CREDS.private_key) return false;
  try {
    const auth = new GoogleAuth({ credentials: GOOGLE_CREDS, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    });
    return r.ok;
  } catch (e) { console.error('[SHEETS]', e.message); return false; }
}

async function sbQuery(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } };
  if (body) opts.body = JSON.stringify(body);
  // POST/PATCH: richiedi rappresentazione delle righe risultanti
  if (method === 'POST' || method === 'PATCH') opts.headers['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (method === 'GET') return res.json();
  return res;
}

// Verifica PIN e (opzionalmente) un permesso specifico; usato dagli endpoint magazzino.
async function verifyPin(pin, perm) {
  if (!pin) return { error: 'pin richiesto', code: 400 };
  const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,user_id,stato,permissions`);
  if (!emps?.length) return { error: 'PIN non trovato', code: 404 };
  const emp = emps[0];
  if (emp.stato !== 'Attivo') return { error: 'Dipendente non attivo', code: 403 };
  if (perm) {
    const perms = emp.permissions || {};
    if (!perms[perm]) return { error: 'Permesso "' + perm + '" non autorizzato per questo dipendente', code: 403 };
  }
  return { emp };
}

// Aggiorna article_stock applicando un delta (o setta direttamente se absolute != null).
async function upsertStockDelta(userId, locale, sub, nome, unita, delta, prezzo = null, absolute = null) {
  const existing = await sbQuery(`article_stock?user_id=eq.${userId}&locale=eq.${encodeURIComponent(locale)}&sub_location=eq.${encodeURIComponent(sub)}&nome_articolo=eq.${encodeURIComponent(nome)}&select=id,quantita,prezzo_medio&limit=1`);
  if (existing?.[0]) {
    const row = existing[0];
    const nuovaQty = absolute != null ? absolute : Math.round(((Number(row.quantita) || 0) + delta) * 1000) / 1000;
    const nuovoPrezzoMedio = prezzo != null
      ? row.prezzo_medio
        ? Math.round((Number(row.prezzo_medio) * 0.7 + Number(prezzo) * 0.3) * 10000) / 10000
        : Number(prezzo)
      : row.prezzo_medio;
    await sbQuery(`article_stock?id=eq.${row.id}`, 'PATCH', {
      quantita: nuovaQty, prezzo_medio: nuovoPrezzoMedio,
      unita: unita || undefined, updated_at: new Date().toISOString(),
    });
  } else {
    await sbQuery('article_stock', 'POST', [{
      user_id: userId, locale, sub_location: sub, nome_articolo: nome,
      unita: unita || null,
      quantita: absolute != null ? absolute : delta,
      prezzo_medio: prezzo != null ? Number(prezzo) : null,
    }]);
  }
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Coordinate locali (da rendere configurabili)
const LOCALE_COORDS = {
  'REMEMBEER': { lat: 44.8857895, lng: 7.3293777 },
  'CASA DE AMICIS': { lat: 44.8858039, lng: 7.3299022 },
  'LABORATORIO': { lat: 44.885515, lng: 7.329369 }
};
const MAX_DISTANCE = 50; // metri

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.body || req.query || {};

  try {
    switch (action) {
      // Verifica PIN e ritorna info dipendente + ultimo movimento + permessi
      case 'verify': {
        const { pin, locale } = req.body;
        if (!pin || !locale) return res.status(400).json({ error: 'pin e locale richiesti' });

        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,ruolo,locale,stato,permissions,user_id`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });

        const emp = emps[0];
        if (emp.stato !== 'Attivo') return res.status(403).json({ error: 'Dipendente non attivo' });

        // Ultimo movimento oggi
        const today = new Date().toISOString().split('T')[0];
        const last = await sbQuery(`attendance?employee_id=eq.${emp.id}&locale=eq.${encodeURIComponent(locale)}&timestamp=gte.${today}T00:00:00&order=timestamp.desc&limit=1`);
        const lastTipo = last?.[0]?.tipo || null;
        const suggestedTipo = lastTipo === 'entrata' ? 'uscita' : 'entrata';

        // Carica le checklist assegnate al dipendente. Supporto sia il vecchio
        // formato singolo (checklist_entrata_id) sia il nuovo array (_ids).
        // La checklist effettivamente mostrata è quella che matcha il LOCALE
        // corrente del QR (così un dipendente che lavora su più locali vede
        // la checklist giusta in base a dove sta timbrando).
        const perms = emp.permissions || {};
        const entrataIds = Array.isArray(perms.checklist_entrata_ids) ? perms.checklist_entrata_ids
                          : (perms.checklist_entrata_id ? [perms.checklist_entrata_id] : []);
        const uscitaIds  = Array.isArray(perms.checklist_uscita_ids) ? perms.checklist_uscita_ids
                          : (perms.checklist_uscita_id  ? [perms.checklist_uscita_id]  : []);
        const allIds = [...new Set([...entrataIds, ...uscitaIds].filter(Boolean))];
        let checklistEntrata = null, checklistUscita = null;
        if (allIds.length > 0) {
          const cls = await sbQuery(`attendance_checklists?id=in.(${allIds.join(',')})&select=id,nome,locale,reparto,momento,items,google_sheet_tab,attivo`);
          const arr = Array.isArray(cls) ? cls : [];
          checklistEntrata = arr.find(c => entrataIds.includes(c.id) && c.locale === locale && c.attivo) || null;
          checklistUscita  = arr.find(c => uscitaIds.includes(c.id)  && c.locale === locale && c.attivo) || null;
        }

        return res.status(200).json({
          employee: { id: emp.id, nome: emp.nome, ruolo: emp.ruolo, locale: emp.locale, stato: emp.stato },
          permissions: perms,
          lastTipo, suggestedTipo, lastTimestamp: last?.[0]?.timestamp,
          checklist_entrata: checklistEntrata,
          checklist_uscita: checklistUscita,
        });
      }

      // ─── RICETTE DISPONIBILI ──────────────────────────────────────
      case 'recipes': {
        const v = await verifyPin(req.body?.pin, null);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const recs = await sbQuery(`recipes?user_id=eq.${v.emp.user_id}&select=id,nome_prodotto,reparto,prezzo_vendita,ingredienti&order=nome_prodotto`);
        // Ritorna solo quelle con ingredienti validi
        const list = (recs || []).filter(r => Array.isArray(r.ingredienti) && r.ingredienti.length > 0);
        return res.status(200).json({ recipes: list });
      }

      // ─── CONSUMO PERSONALE ────────────────────────────────────────
      // Consuma N porzioni di una ricetta. Esplode gli ingredienti e
      // crea uno scarico per ciascuno sul magazzino del locale, con
      // fonte='consumo_dipendente' e riferimento_id = employee_id.
      case 'consumo': {
        const { pin, locale, nome_prodotto, porzioni = 1, note } = req.body;
        const v = await verifyPin(pin, 'consumo');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale || !nome_prodotto) return res.status(400).json({ error: 'locale e nome_prodotto richiesti' });
        const n = Number(porzioni) || 1;
        if (!(n > 0)) return res.status(400).json({ error: 'porzioni non valide' });

        const recs = await sbQuery(`recipes?user_id=eq.${v.emp.user_id}&nome_prodotto=eq.${encodeURIComponent(nome_prodotto)}&select=nome_prodotto,ingredienti&limit=1`);
        if (!recs?.[0]) return res.status(404).json({ error: 'Ricetta non trovata: ' + nome_prodotto });
        const ingredienti = recs[0].ingredienti || [];
        if (ingredienti.length === 0) return res.status(400).json({ error: 'Ricetta senza ingredienti' });

        const toBase = (qty, um) => {
          const q = Number(qty) || 0;
          const u = (um || 'PZ').toLowerCase();
          if (u === 'g') return { qty: q / 1000, um: 'KG' };
          if (u === 'cl') return { qty: q / 100, um: 'LT' };
          if (u === 'ml') return { qty: q / 1000, um: 'LT' };
          return { qty: q, um: (um || 'PZ').toUpperCase() };
        };

        const rows = [];
        let totalValue = 0;
        const scaricati = [];
        for (const ingr of ingredienti) {
          const nomeArt = (ingr.nome_articolo || '').trim();
          if (!nomeArt) continue;
          const base = toBase(ingr.quantita, ingr.unita);
          const qtyIngr = base.qty * n; // moltiplica per numero porzioni
          if (qtyIngr <= 0) continue;
          // Prezzo medio da stock (se esiste)
          const st = await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(locale)}&nome_articolo=eq.${encodeURIComponent(nomeArt)}&select=prezzo_medio,unita&limit=1`);
          const pu = Number(st?.[0]?.prezzo_medio) || null;
          const val = pu ? Math.round(qtyIngr * pu * 100) / 100 : null;
          if (val) totalValue += val;
          rows.push({
            user_id: v.emp.user_id, locale, sub_location: 'principale',
            nome_articolo: nomeArt, tipo: 'scarico',
            quantita: Math.round(qtyIngr * 1000) / 1000, unita: base.um,
            prezzo_unitario: pu, valore_totale: val,
            fonte: 'consumo_dipendente', riferimento_id: v.emp.id,
            riferimento_label: `Consumo ${v.emp.nome} · ${nome_prodotto}${n > 1 ? ' x' + n : ''}`,
            note: note || null,
            created_by: v.emp.user_id,
          });
          scaricati.push({ nome: nomeArt, qty: Math.round(qtyIngr * 1000) / 1000, um: base.um });
        }
        if (rows.length === 0) return res.status(400).json({ error: 'Nessun ingrediente valido nella ricetta' });
        await sbQuery('article_movement', 'POST', rows);
        for (const r of rows) {
          await upsertStockDelta(v.emp.user_id, locale, 'principale', r.nome_articolo, r.unita, -r.quantita);
        }
        return res.status(201).json({
          ok: true, nome: v.emp.nome, ricetta: nome_prodotto, porzioni: n,
          scaricati, valore_totale: Math.round(totalValue * 100) / 100,
        });
      }

      // ─── LISTA ARTICOLI DI UN LOCALE (per UI mobile) ──────────────
      case 'articles': {
        const { pin, locale } = req.body;
        const v = await verifyPin(pin, null); // basta che il pin sia valido
        if (v.error) return res.status(v.code).json({ error: v.error });
        const items = await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(locale)}&select=nome_articolo,unita,quantita,prezzo_medio&order=nome_articolo`);
        return res.status(200).json({ items: items || [] });
      }

      // ─── TRASFERIMENTO TRA LOCALI ─────────────────────────────────
      case 'trasferimento': {
        const { pin, locale_from, locale_to, nome_articolo, quantita, unita, note } = req.body;
        const v = await verifyPin(pin, 'spostamenti');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale_from || !locale_to || !nome_articolo || !quantita) return res.status(400).json({ error: 'locale_from, locale_to, nome_articolo, quantita richiesti' });
        if (locale_from === locale_to) return res.status(400).json({ error: 'I due locali devono essere diversi' });
        const qty = Number(quantita);
        if (!(qty > 0)) return res.status(400).json({ error: 'quantita non valida' });
        const stock = await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(locale_from)}&nome_articolo=eq.${encodeURIComponent(nome_articolo)}&select=prezzo_medio,unita&limit=1`);
        const prezzoMedio = Number(stock?.[0]?.prezzo_medio) || null;
        const um = unita || stock?.[0]?.unita || null;
        const valoreTot = prezzoMedio ? Math.round(qty * prezzoMedio * 100) / 100 : null;
        const refLabel = `Trasferimento ${v.emp.nome} ${locale_from} → ${locale_to}`;
        // Due movimenti: out su locale_from, in su locale_to
        await sbQuery('article_movement', 'POST', [
          {
            user_id: v.emp.user_id, locale: locale_from, sub_location: 'principale',
            nome_articolo, tipo: 'trasferimento_out', quantita: qty, unita: um,
            prezzo_unitario: prezzoMedio, valore_totale: valoreTot,
            fonte: 'trasferimento', riferimento_id: v.emp.id, riferimento_label: refLabel,
            sub_location_target: locale_to, note: note || null, created_by: v.emp.user_id,
          },
          {
            user_id: v.emp.user_id, locale: locale_to, sub_location: 'principale',
            nome_articolo, tipo: 'trasferimento_in', quantita: qty, unita: um,
            prezzo_unitario: prezzoMedio, valore_totale: valoreTot,
            fonte: 'trasferimento', riferimento_id: v.emp.id, riferimento_label: refLabel,
            sub_location_target: locale_from, note: note || null, created_by: v.emp.user_id,
          }
        ]);
        await upsertStockDelta(v.emp.user_id, locale_from, 'principale', nome_articolo, um, -qty);
        await upsertStockDelta(v.emp.user_id, locale_to,   'principale', nome_articolo, um, +qty, prezzoMedio);
        return res.status(201).json({ ok: true, nome: v.emp.nome, articolo: nome_articolo, quantita: qty, from: locale_from, to: locale_to });
      }

      // ─── INVENTARIO ───────────────────────────────────────────────
      // Schema legacy: warehouse_inventories.note contiene JSON { locale, sub_location, tipo }
      // warehouse_inventory_items.note contiene JSON { nome_articolo, unita, prezzo_medio, sub_location, locale }
      case 'inv-open': {
        const { pin, locale } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale) return res.status(400).json({ error: 'locale richiesto' });
        // Cerca inventario in_corso per questo locale
        const all = await sbQuery(`warehouse_inventories?user_id=eq.${v.emp.user_id}&stato=eq.in_corso&select=id,data,stato,note&order=data.desc`);
        const existing = (all || []).find(i => { try { return JSON.parse(i.note || '{}').locale === locale; } catch { return false; } });
        let inv;
        let reused = false;
        if (existing) {
          // Se l'inventario esiste ma e' vuoto (es. creato prima del fix), lo ripopolo.
          const cnt = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${existing.id}&select=id&limit=1`);
          if ((cnt || []).length > 0) {
            return res.status(200).json({ inventory: existing });
          }
          inv = existing;
          reused = true;
        } else {
          // Nuovo inventario
          const today = new Date().toISOString().split('T')[0];
          const note = JSON.stringify({ locale, sub_location: 'principale', tipo: 'sessione', apertura_da: v.emp.nome });
          const resp = await sbQuery('warehouse_inventories', 'POST', [{ user_id: v.emp.user_id, data: today, stato: 'in_corso', note }]);
          const created = resp.ok ? await resp.json() : null;
          inv = created?.[0];
          if (!inv) return res.status(500).json({ error: 'Impossibile creare inventario' });
        }

        // Raccogli l'UNIONE di tutti gli articoli conosciuti per quel locale:
        //   - da article_stock (giacenza corrente)
        //   - da warehouse_invoice_items (articoli acquistati in fatture di quel locale)
        // Cosi' anche quando article_stock e' vuoto, l'inventario mostra comunque tutto.
        // article_stock al momento NON ha colonna `magazzino` su questo schema:
        // selezionarla a vuoto, il fallback lookup userà invoice_items + storico inventari.
        const stock = await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(locale)}&select=id,nome_articolo,unita,quantita,prezzo_medio`);
        const invs = await sbQuery(`warehouse_invoices?locale=eq.${encodeURIComponent(locale)}&user_id=eq.${v.emp.user_id}&select=id`);
        const invIds = Array.isArray(invs) ? invs.map(x => x.id).filter(Boolean) : [];
        let invoiceArts = [];
        // Set di articoli da nascondere allo staff (qualsiasi riga con escludi_inventario_staff=true)
        const hiddenStaff = new Set();
        if (invIds.length > 0) {
          const ia = await sbQuery(`warehouse_invoice_items?invoice_id=in.(${invIds.join(',')})&escludi_magazzino=eq.false&nome_articolo=not.is.null&select=nome_articolo,unita,magazzino,escludi_inventario_staff`);
          const arr = Array.isArray(ia) ? ia : [];
          invoiceArts = arr;
          arr.forEach(it => { if (it.escludi_inventario_staff && it.nome_articolo) hiddenStaff.add(it.nome_articolo); });
        }
        // Lookup storico: leggo il `note` JSON degli inventory_items di inventari precedenti
        // dello stesso locale, per ricordare il magazzino di articoli "fantasma" (mai fatturati).
        const histMagByName = {};
        try {
          const prevInvs = await sbQuery(`warehouse_inventories?user_id=eq.${v.emp.user_id}&select=id,note&order=data.desc&limit=20`);
          const prevInvIds = Array.isArray(prevInvs)
            ? prevInvs.filter(p => { try { return JSON.parse(p.note || '{}').locale === locale } catch { return false } }).map(p => p.id).filter(Boolean)
            : [];
          if (prevInvIds.length > 0) {
            const prevItemsRes = await sbQuery(`warehouse_inventory_items?inventory_id=in.(${prevInvIds.join(',')})&select=note`);
            const prevItems = Array.isArray(prevItemsRes) ? prevItemsRes : [];
            for (const it of prevItems) {
              try {
                const m = JSON.parse(it.note || '{}');
                if (m.nome_articolo && m.magazzino && !histMagByName[m.nome_articolo]) {
                  histMagByName[m.nome_articolo] = m.magazzino;
                }
              } catch {}
            }
          }
        } catch (e) { /* best-effort */ }
        // Unione per nome_articolo; stock ha priorita' (ha giacenza e prezzo_medio).
        // Magazzino: 1) invoice_items, 2) histMagByName (inventari precedenti) — perché
        // article_stock non ha la colonna magazzino su questo schema.
        const byName = {};
        (stock || []).forEach(s => {
          if (!s.nome_articolo) return;
          byName[s.nome_articolo] = {
            nome_articolo: s.nome_articolo, unita: s.unita || '',
            quantita: Number(s.quantita || 0),
            prezzo_medio: s.prezzo_medio || null,
            magazzino: histMagByName[s.nome_articolo] || null,
            stock_id: s.id,
          };
        });
        (invoiceArts || []).forEach(it => {
          const n = (it.nome_articolo || '').trim();
          if (!n) return;
          if (byName[n]) {
            // Fattura ha priorità sullo storico inventari per il magazzino
            if (it.magazzino) byName[n].magazzino = it.magazzino;
            return;
          }
          byName[n] = { nome_articolo: n, unita: it.unita || '', quantita: 0, prezzo_medio: null, magazzino: it.magazzino || histMagByName[n] || null, stock_id: null };
        });
        // Filtra articoli marcati "escludi_inventario_staff" (admin li ha nascosti dal mobile)
        const rows = Object.values(byName)
          .filter(r => !hiddenStaff.has(r.nome_articolo))
          .sort((a, b) => a.nome_articolo.localeCompare(b.nome_articolo));

        if (rows.length > 0) {
          // product_id NOT NULL: uso stock.id quando disponibile, altrimenti genero uuid dummy dal nome.
          // Per semplicita' uso inv.id quando manca (che e' un UUID valido sempre).
          const items = rows.map(r => ({
            inventory_id: inv.id,
            product_id: r.stock_id || inv.id,
            giacenza_teorica: r.quantita,
            giacenza_reale: null,
            note: JSON.stringify({ nome_articolo: r.nome_articolo, unita: r.unita, prezzo_medio: r.prezzo_medio, magazzino: r.magazzino, sub_location: 'principale', locale }),
          }));
          await sbQuery('warehouse_inventory_items', 'POST', items);
        }
        return res.status(reused ? 200 : 201).json({ inventory: inv, created: !reused, reused, articoli: rows.length });
      }

      case 'inv-articles': {
        const { pin, inventory_id, locale: reqLocale } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!inventory_id) return res.status(400).json({ error: 'inventory_id richiesto' });
        const invs = await sbQuery(`warehouse_inventories?id=eq.${inventory_id}&select=*&limit=1`);
        if (!invs?.[0]) return res.status(404).json({ error: 'Inventario non trovato' });
        const inv = invs[0];
        // Verifica che l'inventario appartenga al locale del QR corrente.
        // Garantisce che un dipendente che timbra su CASA DE AMICIS non
        // veda articoli di REMEMBEER e viceversa.
        let invMeta = {};
        try { invMeta = JSON.parse(inv.note || '{}'); } catch {}
        if (reqLocale && invMeta.locale && invMeta.locale !== reqLocale) {
          return res.status(403).json({ error: `Inventario di ${invMeta.locale}, non corrisponde al locale corrente (${reqLocale})` });
        }
        const items = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${inventory_id}&select=*`);
        // Lookup magazzino per ogni articolo: priorità a `meta.magazzino` (salvato in inv-open),
        // fallback su article_stock del locale (per inventari già aperti senza magazzino in note),
        // ulteriore fallback su warehouse_invoice_items.
        let invLocale = '';
        const itemsArr = Array.isArray(items) ? items : [];
        for (const it of itemsArr) {
          try { invLocale = JSON.parse(it.note || '{}').locale || ''; if (invLocale) break } catch {}
        }
        const magByName = {};
        try {
          if (invLocale) {
            // Lookup magazzino da warehouse_invoice_items dello stesso locale.
            // (article_stock non ha colonna magazzino su questo schema.)
            const invsRes = await sbQuery(`warehouse_invoices?locale=eq.${encodeURIComponent(invLocale)}&user_id=eq.${v.emp.user_id}&select=id`);
            const invsLoc = Array.isArray(invsRes) ? invsRes : [];
            if (invsLoc.length > 0) {
              const invIds = invsLoc.map(x => x.id).filter(Boolean);
              if (invIds.length > 0) {
                const itemsInvRes = await sbQuery(`warehouse_invoice_items?invoice_id=in.(${invIds.join(',')})&nome_articolo=not.is.null&magazzino=not.is.null&select=nome_articolo,magazzino`);
                const itemsInv = Array.isArray(itemsInvRes) ? itemsInvRes : [];
                itemsInv.forEach(it => {
                  if (it && it.nome_articolo && it.magazzino && !magByName[it.nome_articolo]) {
                    magByName[it.nome_articolo] = it.magazzino;
                  }
                });
              }
            }
          }
        } catch (lookupErr) {
          console.error('[inv-articles] magazzino lookup failed:', lookupErr?.message || lookupErr);
        }
        const expectedLocale = invMeta.locale || reqLocale || null;
        // Carica config conteggio inventario per tutti gli articoli del locale
        const cfgByName = {};
        if (expectedLocale) {
          try {
            const cfgRes = await sbQuery(`article_inventory_config?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(expectedLocale)}&select=*`);
            const cfgArr = Array.isArray(cfgRes) ? cfgRes : [];
            for (const c of cfgArr) cfgByName[c.nome_articolo] = c;
          } catch (e) { console.error('[inv-articles] cfg lookup failed:', e?.message || e); }
        }
        const mapped = itemsArr.map(it => {
          let meta = {};
          try { meta = JSON.parse(it.note || '{}'); } catch {}
          const nome = meta.nome_articolo || '';
          const cfg = cfgByName[nome] || null;
          return {
            id: it.id,
            nome_articolo: nome,
            unita: meta.unita || '',
            giacenza_teorica: Number(it.giacenza_teorica || 0),
            giacenza_reale: it.giacenza_reale,
            prezzo_medio: meta.prezzo_medio || null,
            magazzino: meta.magazzino || magByName[nome] || null,
            counted_by_name: meta.counted_by_name || null,
            counted_at: meta.counted_at || null,
            is_user_added: !!meta.is_user_added,
            // modalità conteggio + valori già salvati
            count_mode: meta.count_mode || (cfg?.modalita || 'unita'),
            qty_pezzi: meta.qty_pezzi != null ? Number(meta.qty_pezzi) : null,
            qty_aperto: meta.qty_aperto != null ? Number(meta.qty_aperto) : null,
            volume_pezzo: cfg?.volume_pezzo ?? null,
            unita_pezzo: cfg?.unita_pezzo ?? 'pz',
            unita_apertura: cfg?.unita_apertura ?? 'ml',
            modalita: cfg?.modalita || 'unita',
            _itemLocale: meta.locale || null,
          };
        })
        .filter(x => x.nome_articolo)
        .filter(x => !expectedLocale || !x._itemLocale || x._itemLocale === expectedLocale)
        .map(({ _itemLocale, ...x }) => x)
        .sort((a, b) => a.nome_articolo.localeCompare(b.nome_articolo));
        return res.status(200).json({ inventory: inv, items: mapped });
      }

      case 'inv-count': {
        // Supporta due modalità:
        //  - "unita":  { giacenza_reale } numero diretto (litri/kg)
        //  - "pezzi":  { qty_pezzi, qty_aperto } → calcolo server-side da config articolo
        const { pin, inventory_id, nome_articolo, giacenza_reale, qty_pezzi, qty_aperto } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!inventory_id || !nome_articolo) return res.status(400).json({ error: 'inventory_id, nome_articolo richiesti' });
        const isPezzi = qty_pezzi != null || qty_aperto != null;
        if (!isPezzi && giacenza_reale == null) return res.status(400).json({ error: 'giacenza_reale richiesta o qty_pezzi/qty_aperto' });

        const items = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${inventory_id}&select=id,giacenza_teorica,note`);
        const itemsArr = Array.isArray(items) ? items : [];
        const match = itemsArr.find(it => { try { return JSON.parse(it.note || '{}').nome_articolo === nome_articolo; } catch { return false; } });
        if (!match) return res.status(404).json({ error: 'Riga inventario non trovata per ' + nome_articolo });

        let meta = {};
        try { meta = JSON.parse(match.note || '{}'); } catch {}

        let real;
        if (isPezzi) {
          // Carica config per conversione
          const invs = await sbQuery(`warehouse_inventories?id=eq.${inventory_id}&select=note&limit=1`);
          let invMeta = {};
          try { invMeta = JSON.parse(invs?.[0]?.note || '{}'); } catch {}
          const cfgRes = await sbQuery(`article_inventory_config?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(invMeta.locale || '')}&nome_articolo=eq.${encodeURIComponent(nome_articolo)}&select=*&limit=1`);
          const cfg = (Array.isArray(cfgRes) ? cfgRes : [])[0];
          if (!cfg || cfg.modalita !== 'pezzi' || !cfg.volume_pezzo) return res.status(400).json({ error: 'articolo non configurato in modalità pezzi' });
          const pz = Number(qty_pezzi || 0) * Number(cfg.volume_pezzo || 0);
          const apRaw = Number(qty_aperto || 0);
          let apConv = 0;
          switch ((cfg.unita_apertura || 'ml').toLowerCase()) {
            case 'ml': case 'g': apConv = apRaw / 1000; break;
            case 'cl':           apConv = apRaw / 100;  break;
            default:             apConv = apRaw;        break;
          }
          real = Math.round((pz + apConv) * 10000) / 10000;
          meta.count_mode = 'pezzi';
          meta.qty_pezzi = qty_pezzi != null ? Number(qty_pezzi) : null;
          meta.qty_aperto = qty_aperto != null ? Number(qty_aperto) : null;
          meta.volume_pezzo = cfg.volume_pezzo;
          meta.unita_apertura = cfg.unita_apertura;
        } else {
          real = Number(giacenza_reale);
          delete meta.count_mode; delete meta.qty_pezzi; delete meta.qty_aperto;
        }
        const diff = real - Number(match.giacenza_teorica || 0);
        meta.counted_by_employee_id = v.emp.id;
        meta.counted_by_name = v.emp.nome || '';
        meta.counted_at = new Date().toISOString();
        await sbQuery(`warehouse_inventory_items?id=eq.${match.id}`, 'PATCH', {
          giacenza_reale: real, differenza: diff, note: JSON.stringify(meta),
        });
        return res.status(200).json({ ok: true, giacenza_reale: real });
      }

      case 'inv-add-article': {
        const { pin, inventory_id, nome_articolo, unita, magazzino, giacenza_reale } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!inventory_id || !nome_articolo) return res.status(400).json({ error: 'inventory_id e nome_articolo richiesti' });
        // Normalizza nome
        const nome = String(nome_articolo).trim();
        if (!nome) return res.status(400).json({ error: 'nome_articolo vuoto' });
        // Recupera locale dall'inventario
        const invs = await sbQuery(`warehouse_inventories?id=eq.${inventory_id}&select=note,user_id&limit=1`);
        if (!invs?.[0]) return res.status(404).json({ error: 'Inventario non trovato' });
        let invMeta = {};
        try { invMeta = JSON.parse(invs[0].note || '{}'); } catch {}
        // Controlla duplicati nello stesso inventario
        const existing = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${inventory_id}&select=id,note`);
        const existingArr = Array.isArray(existing) ? existing : [];
        const dup = existingArr.find(it => { try { return JSON.parse(it.note || '{}').nome_articolo?.toLowerCase().trim() === nome.toLowerCase(); } catch { return false; } });
        if (dup) return res.status(409).json({ error: `"${nome}" è già presente nell'inventario` });
        const realNum = giacenza_reale != null && giacenza_reale !== '' ? Number(giacenza_reale) : null;
        const meta = {
          nome_articolo: nome,
          unita: unita || '',
          magazzino: (magazzino || '').toLowerCase() || null,
          locale: invMeta.locale || '',
          sub_location: invMeta.sub_location || 'principale',
          prezzo_medio: null,
          is_user_added: true,
          counted_by_employee_id: v.emp.id,
          counted_by_name: v.emp.nome || '',
          counted_at: new Date().toISOString(),
        };
        const row = {
          inventory_id,
          product_id: inventory_id, // fallback uuid valido
          giacenza_teorica: 0,
          giacenza_reale: realNum,
          differenza: realNum != null ? realNum : null,
          note: JSON.stringify(meta),
        };
        const inserted = await sbQuery('warehouse_inventory_items', 'POST', row);
        return res.status(201).json({ ok: true, item: Array.isArray(inserted) ? inserted[0] : inserted });
      }

      case 'inv-close': {
        const { pin, inventory_id } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!inventory_id) return res.status(400).json({ error: 'inventory_id richiesto' });
        const invs = await sbQuery(`warehouse_inventories?id=eq.${inventory_id}&select=*&limit=1`);
        if (!invs?.[0]) return res.status(404).json({ error: 'Inventario non trovato' });
        const inv = invs[0];
        let locale = 'principale';
        try { locale = JSON.parse(inv.note || '{}').locale || locale; } catch {}
        const items = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${inventory_id}&select=*`);
        const today = new Date().toISOString().split('T')[0];
        const movements = [];
        for (const it of (items || [])) {
          if (it.giacenza_reale == null) continue;
          let meta = {};
          try { meta = JSON.parse(it.note || '{}'); } catch {}
          const nome_articolo = meta.nome_articolo;
          if (!nome_articolo) continue;
          const diff = Number(it.giacenza_reale || 0) - Number(it.giacenza_teorica || 0);
          if (Math.abs(diff) < 0.001) continue;
          movements.push({
            user_id: v.emp.user_id, locale, sub_location: 'principale',
            nome_articolo, tipo: 'correzione', quantita: Math.abs(diff),
            unita: meta.unita || null, prezzo_unitario: meta.prezzo_medio || null,
            valore_totale: meta.prezzo_medio ? Math.round(Math.abs(diff) * Number(meta.prezzo_medio) * 100) / 100 : null,
            fonte: 'inventario', riferimento_id: inventory_id,
            riferimento_label: 'Chiusura inventario ' + today + ' (' + v.emp.nome + ')',
            note: `${it.giacenza_teorica || 0} -> ${it.giacenza_reale} (diff ${diff >= 0 ? '+' : ''}${diff})`,
            created_by: v.emp.user_id,
          });
          await upsertStockDelta(v.emp.user_id, locale, 'principale', nome_articolo, meta.unita, 0, meta.prezzo_medio, Number(it.giacenza_reale));
        }
        if (movements.length > 0) await sbQuery('article_movement', 'POST', movements);
        await sbQuery(`warehouse_inventories?id=eq.${inventory_id}`, 'PATCH', { stato: 'chiuso' });
        return res.status(200).json({ ok: true, correzioni: movements.length });
      }

      // Registra timbratura
      case 'timbra': {
        const { pin, locale, tipo, lat, lng } = req.body;
        if (!pin || !locale || !tipo) return res.status(400).json({ error: 'pin, locale e tipo richiesti' });

        // Verifica PIN
        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });
        const emp = emps[0];

        // Verifica GPS
        let distanza = null;
        const coords = LOCALE_COORDS[locale];
        if (coords && lat && lng) {
          distanza = Math.round(haversineDistance(lat, lng, coords.lat, coords.lng));
          if (distanza > MAX_DISTANCE) {
            return res.status(403).json({ error: `Troppo lontano dal locale (${distanza}m, max ${MAX_DISTANCE}m)`, distanza });
          }
        }

        // Rate limiting: max 1 timbra ogni 5 min
        const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
        const recent = await sbQuery(`attendance?employee_id=eq.${emp.id}&timestamp=gte.${fiveMinAgo}&limit=1`);
        if (recent?.length) {
          return res.status(429).json({ error: 'Attendi almeno 5 minuti tra una timbratura e l\'altra' });
        }

        // Salva
        const r = await sbQuery('attendance', 'POST', [{
          employee_id: emp.id, locale, tipo,
          timestamp: new Date().toISOString(),
          lat: lat || null, lng: lng || null, distanza_m: distanza
        }]);
        const attId = Array.isArray(r) && r[0]?.id ? r[0].id : null;

        // Scrivi su Google Sheets
        const now = new Date();
        const data = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const ora = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
        appendToSheet(locale, [data, ora, emp.nome, tipo, '', locale]);

        return res.status(201).json({ ok: true, nome: emp.nome, tipo, distanza, timestamp: now.toISOString(), attendance_id: attId });
      }

      // ─── CHECKLIST: timbra atomico con compilazione obbligatoria ────
      // Chiamato dal mobile quando il dipendente ha una checklist assegnata
      // per il momento (entrata/uscita). Equivalente a `timbra` ma con
      // verifica risposte + insert su attendance_checklist_responses + sync
      // sul tab Google Sheet della checklist.
      case 'checklist-submit': {
        const { pin, locale, momento, lat, lng, checklist_id, risposte } = req.body;
        if (!pin || !locale || !momento || !checklist_id) {
          return res.status(400).json({ error: 'pin, locale, momento, checklist_id richiesti' });
        }
        if (momento !== 'entrata' && momento !== 'uscita') {
          return res.status(400).json({ error: "momento deve essere 'entrata' o 'uscita'" });
        }

        // Verifica PIN + permessi checklist
        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,permissions,user_id`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });
        const emp = emps[0];
        const perms = emp.permissions || {};
        const expectedKey = momento === 'entrata' ? 'checklist_entrata' : 'checklist_uscita';
        const expectedIds = Array.isArray(perms[expectedKey + '_ids']) ? perms[expectedKey + '_ids']
                           : (perms[expectedKey + '_id'] ? [perms[expectedKey + '_id']] : []);
        if (!expectedIds.includes(checklist_id)) {
          return res.status(403).json({ error: 'Checklist non assegnata a questo dipendente' });
        }

        // Carica checklist e verifica items required
        const cls = await sbQuery(`attendance_checklists?id=eq.${checklist_id}&select=*&limit=1`);
        if (!cls?.[0]) return res.status(404).json({ error: 'Checklist non trovata' });
        const cl = cls[0];
        if (!cl.attivo) return res.status(403).json({ error: 'Checklist disabilitata' });
        const items = Array.isArray(cl.items) ? cl.items : [];
        const ans = risposte || {};
        for (const it of items) {
          if (!it.required) continue;
          const v = ans[it.id];
          if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
            return res.status(400).json({ error: `Domanda obbligatoria non compilata: "${it.label}"` });
          }
        }

        // Verifica GPS (riusa logica di timbra)
        let distanza = null;
        const coords = LOCALE_COORDS[locale];
        if (coords && lat && lng) {
          distanza = Math.round(haversineDistance(lat, lng, coords.lat, coords.lng));
          if (distanza > MAX_DISTANCE) {
            return res.status(403).json({ error: `Troppo lontano dal locale (${distanza}m, max ${MAX_DISTANCE}m)`, distanza });
          }
        }

        // Rate limit
        const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
        const recent = await sbQuery(`attendance?employee_id=eq.${emp.id}&timestamp=gte.${fiveMinAgo}&limit=1`);
        if (recent?.length) {
          return res.status(429).json({ error: 'Attendi almeno 5 minuti tra una timbratura e l\'altra' });
        }

        // Salva attendance
        const nowISO = new Date().toISOString();
        const attRes = await sbQuery('attendance', 'POST', [{
          employee_id: emp.id, locale, tipo: momento,
          timestamp: nowISO,
          lat: lat || null, lng: lng || null, distanza_m: distanza
        }]);
        const attId = Array.isArray(attRes) && attRes[0]?.id ? attRes[0].id : null;

        // Salva risposta checklist
        const respRow = {
          user_id: emp.user_id,
          checklist_id: cl.id,
          attendance_id: attId,
          employee_id: emp.id,
          employee_name: emp.nome,
          locale, reparto: cl.reparto, momento,
          risposte: ans,
          google_sheet_synced: false,
        };
        const respRes = await sbQuery('attendance_checklist_responses', 'POST', [respRow]);
        const respId = Array.isArray(respRes) && respRes[0]?.id ? respRes[0].id : null;

        // Google Sheet sync (best-effort)
        const now = new Date();
        const dataIt = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const oraIt = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
        // Riga timbratura (tab default)
        appendToSheet(locale, [dataIt, oraIt, emp.nome, momento, '', locale]);
        // Riga risposte sul tab dedicato
        if (cl.google_sheet_tab) {
          const labelsRow = [dataIt, oraIt, emp.nome, cl.reparto, momento, ...items.map(it => formatAnswer(ans[it.id]))];
          const synced = await appendToSheet(locale, labelsRow, `${cl.google_sheet_tab}!A:Z`);
          if (synced && respId) {
            await sbQuery(`attendance_checklist_responses?id=eq.${respId}`, 'PATCH', { google_sheet_synced: true });
          }
        }

        return res.status(201).json({
          ok: true, nome: emp.nome, tipo: momento, distanza, timestamp: nowISO,
          attendance_id: attId, response_id: respId,
        });
      }

      // ─── CHECKLIST: salva solo la risposta (timbratura già esistente) ─
      // Usato dopo ENTRATA: il dipendente timbra subito (orario reale di
      // arrivo), poi compila la checklist senza che blocchi la timbratura.
      // La response viene collegata all'attendance_id già creato.
      case 'checklist-response': {
        const { pin, locale, momento, checklist_id, risposte, attendance_id } = req.body;
        if (!pin || !momento || !checklist_id) {
          return res.status(400).json({ error: 'pin, momento, checklist_id richiesti' });
        }
        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,permissions,user_id`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });
        const emp = emps[0];
        const perms = emp.permissions || {};
        const expectedKey = momento === 'entrata' ? 'checklist_entrata' : 'checklist_uscita';
        const expectedIds = Array.isArray(perms[expectedKey + '_ids']) ? perms[expectedKey + '_ids']
                           : (perms[expectedKey + '_id'] ? [perms[expectedKey + '_id']] : []);
        if (!expectedIds.includes(checklist_id)) {
          return res.status(403).json({ error: 'Checklist non assegnata a questo dipendente' });
        }
        const cls = await sbQuery(`attendance_checklists?id=eq.${checklist_id}&select=*&limit=1`);
        if (!cls?.[0]) return res.status(404).json({ error: 'Checklist non trovata' });
        const cl = cls[0];
        const items = Array.isArray(cl.items) ? cl.items : [];
        const ans = risposte || {};
        for (const it of items) {
          if (!it.required) continue;
          const v = ans[it.id];
          if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
            return res.status(400).json({ error: `Domanda obbligatoria non compilata: "${it.label}"` });
          }
        }

        const respRow = {
          user_id: emp.user_id,
          checklist_id: cl.id,
          attendance_id: attendance_id || null,
          employee_id: emp.id,
          employee_name: emp.nome,
          locale: locale || cl.locale,
          reparto: cl.reparto,
          momento,
          risposte: ans,
          google_sheet_synced: false,
        };
        const respRes = await sbQuery('attendance_checklist_responses', 'POST', [respRow]);
        const respId = Array.isArray(respRes) && respRes[0]?.id ? respRes[0].id : null;

        // Google Sheet sync sul tab dedicato (best-effort)
        if (cl.google_sheet_tab) {
          const now = new Date();
          const dataIt = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const oraIt = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
          const labelsRow = [dataIt, oraIt, emp.nome, cl.reparto, momento, ...items.map(it => formatAnswer(ans[it.id]))];
          const synced = await appendToSheet(locale || cl.locale, labelsRow, `${cl.google_sheet_tab}!A:Z`);
          if (synced && respId) {
            await sbQuery(`attendance_checklist_responses?id=eq.${respId}`, 'PATCH', { google_sheet_synced: true });
          }
        }

        return res.status(201).json({ ok: true, response_id: respId });
      }

      // ─── CHECKLIST SKIP: il dipendente delega la compilazione al collega ─
      // Salva una response "skipped=true" per tracking. Per ENTRATA, l'attendance
      // è già stata creata: salva solo lo skip. Per USCITA, crea anche
      // l'attendance (non blocca la timbratura).
      case 'checklist-skip': {
        const { pin, locale, momento, checklist_id, attendance_id, lat, lng } = req.body;
        if (!pin || !locale || !momento || !checklist_id) {
          return res.status(400).json({ error: 'pin, locale, momento, checklist_id richiesti' });
        }
        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,permissions,user_id`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });
        const emp = emps[0];
        const perms = emp.permissions || {};
        const expectedKey = momento === 'entrata' ? 'checklist_entrata' : 'checklist_uscita';
        const expectedIds = Array.isArray(perms[expectedKey + '_ids']) ? perms[expectedKey + '_ids']
                           : (perms[expectedKey + '_id'] ? [perms[expectedKey + '_id']] : []);
        if (!expectedIds.includes(checklist_id)) {
          return res.status(403).json({ error: 'Checklist non assegnata a questo dipendente' });
        }
        const cls = await sbQuery(`attendance_checklists?id=eq.${checklist_id}&select=id,locale,reparto&limit=1`);
        if (!cls?.[0]) return res.status(404).json({ error: 'Checklist non trovata' });
        const cl = cls[0];

        let attId = attendance_id || null;
        let attTimestamp = null;
        // Per USCITA: creo l'attendance ora (lo skip non blocca la timbratura)
        if (momento === 'uscita') {
          let distanza = null;
          const coords = LOCALE_COORDS[locale];
          if (coords && lat && lng) {
            distanza = Math.round(haversineDistance(lat, lng, coords.lat, coords.lng));
            if (distanza > MAX_DISTANCE) {
              return res.status(403).json({ error: `Troppo lontano dal locale (${distanza}m, max ${MAX_DISTANCE}m)`, distanza });
            }
          }
          const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
          const recent = await sbQuery(`attendance?employee_id=eq.${emp.id}&timestamp=gte.${fiveMinAgo}&limit=1`);
          if (recent?.length) {
            return res.status(429).json({ error: 'Attendi almeno 5 minuti tra una timbratura e l\'altra' });
          }
          attTimestamp = new Date().toISOString();
          const r = await sbQuery('attendance', 'POST', [{
            employee_id: emp.id, locale, tipo: 'uscita',
            timestamp: attTimestamp,
            lat: lat || null, lng: lng || null, distanza_m: distanza
          }]);
          attId = Array.isArray(r) && r[0]?.id ? r[0].id : null;
          // Google Sheet timbratura
          const now = new Date();
          const dataIt = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
          const oraIt = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
          appendToSheet(locale, [dataIt, oraIt, emp.nome, 'uscita', '', locale]);
        }

        // Salva response skipped
        const respRow = {
          user_id: emp.user_id,
          checklist_id: cl.id,
          attendance_id: attId,
          employee_id: emp.id,
          employee_name: emp.nome,
          locale, reparto: cl.reparto, momento,
          risposte: {}, skipped: true,
          google_sheet_synced: false,
        };
        const respRes = await sbQuery('attendance_checklist_responses', 'POST', [respRow]);
        const respId = Array.isArray(respRes) && respRes[0]?.id ? respRes[0].id : null;

        return res.status(201).json({ ok: true, skipped: true, response_id: respId, attendance_id: attId, timestamp: attTimestamp });
      }

      // ─── PRODUZIONE MOBILE: lista schede del locale ─────────────────
      case 'prod-recipes': {
        const { pin, locale } = req.body;
        const v = await verifyPin(pin, 'produzione');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale) return res.status(400).json({ error: 'locale richiesto' });
        const rec = await sbQuery(`production_recipes?user_id=eq.${v.emp.user_id}&locale_produzione=eq.${encodeURIComponent(locale)}&attivo=eq.true&select=*&order=nome`);
        return res.status(200).json({ recipes: Array.isArray(rec) ? rec : [] });
      }

      // ─── PRODUZIONE MOBILE: catalogo "cosa posso produrre" ─
      // Ritorna semilavorati (manual_articles) + articoli stock per autocomplete.
      // I semilavorati includono ingredienti + resa per consentire al client
      // lo scaling proporzionale ("voglio farne N → ti calcolo la ricetta").
      case 'prod-articles': {
        const { pin, locale } = req.body;
        const v = await verifyPin(pin, 'produzione');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale) return res.status(400).json({ error: 'locale richiesto' });
        // Articoli da fatture (visibili per il locale)
        const stockArr = await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(locale)}&select=nome_articolo,unita`);
        const stocks = Array.isArray(stockArr) ? stockArr : [];
        // Semilavorati: ritorno anche ingredienti + resa per scaling client-side
        const semiArr = await sbQuery(`manual_articles?user_id=eq.${v.emp.user_id}&select=id,nome,unita,resa,ingredienti,locale,approved`);
        const semis = Array.isArray(semiArr) ? semiArr : [];
        const items = [
          ...stocks.map(s => ({ nome: s.nome_articolo, unita: s.unita || '', tipo: 'articolo' })),
          ...semis.filter(s => !s.locale || s.locale === locale).map(s => ({
            id: s.id,
            nome: s.nome,
            unita: s.unita || '',
            resa: Number(s.resa) || 1,
            ingredienti: Array.isArray(s.ingredienti) ? s.ingredienti : [],
            approved: s.approved !== false,
            tipo: 'semilavorato',
          })),
        ];
        // Dedup by nome
        const seen = new Set();
        const dedup = items.filter(i => {
          const k = i.nome?.toLowerCase().trim();
          if (!k || seen.has(k)) return false;
          seen.add(k); return true;
        }).sort((a, b) => a.nome.localeCompare(b.nome));
        return res.status(200).json({ items: dedup });
      }

      // ─── PRODUZIONE MOBILE: crea nuova scheda produzione ─────────────
      case 'prod-recipe-create': {
        const { pin, locale, nome, ingredienti, resa_quantita, resa_unita, allergeni, procedimento, immagine_url } = req.body;
        const v = await verifyPin(pin, 'produzione');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale || !nome?.trim()) return res.status(400).json({ error: 'locale e nome richiesti' });
        if (!Array.isArray(ingredienti) || ingredienti.length === 0) return res.status(400).json({ error: 'almeno un ingrediente richiesto' });
        // Anti-duplicato (same nome + locale + user)
        const exist = await sbQuery(`production_recipes?user_id=eq.${v.emp.user_id}&nome=eq.${encodeURIComponent(nome.trim())}&locale_produzione=eq.${encodeURIComponent(locale)}&select=id&limit=1`);
        if (exist?.[0]) return res.status(409).json({ error: 'Una scheda con questo nome esiste già per questo locale' });
        const row = {
          user_id: v.emp.user_id,
          nome: nome.trim(),
          locale_produzione: locale,
          locale_destinazione: locale,
          ingredienti: ingredienti.filter(i => i.nome_articolo?.trim() && i.quantita),
          procedimento: procedimento || null,
          allergeni: Array.isArray(allergeni) ? allergeni : [],
          conservazione: null,
          shelf_life_days: null,
          resa_quantita: resa_quantita ? Number(resa_quantita) : null,
          resa_unita: resa_unita || null,
          immagine_url: immagine_url || null,
          attivo: true,
          created_by_employee_id: v.emp.id,
          created_by_employee_name: v.emp.nome,
          approved: false, // Mobile crea sempre con approved=false
        };
        const ins = await sbQuery('production_recipes', 'POST', [row]);
        const created = Array.isArray(ins) && ins[0] ? ins[0] : null;
        return res.status(201).json({ recipe: created });
      }

      // ─── PRODUZIONE MOBILE: crea nuovo semilavorato ──────────────────
      case 'manual-article-create': {
        const { pin, locale, nome, unita, resa, ingredienti } = req.body;
        const v = await verifyPin(pin, 'produzione');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!nome?.trim()) return res.status(400).json({ error: 'nome richiesto' });
        const exist = await sbQuery(`manual_articles?user_id=eq.${v.emp.user_id}&nome=eq.${encodeURIComponent(nome.trim())}&select=id&limit=1`);
        if (exist?.[0]) return res.status(409).json({ error: 'Un semilavorato con questo nome esiste già' });
        const row = {
          user_id: v.emp.user_id,
          nome: nome.trim(),
          unita: unita || null,
          resa: resa ? Number(resa) : 1,
          ingredienti: Array.isArray(ingredienti) ? ingredienti : [],
          locale: locale || null,
          created_by_employee_id: v.emp.id,
          created_by_employee_name: v.emp.nome,
          approved: false,
        };
        const ins = await sbQuery('manual_articles', 'POST', [row]);
        const created = Array.isArray(ins) && ins[0] ? ins[0] : null;
        return res.status(201).json({ article: created });
      }

      // ─── PRODUZIONE MOBILE: avvia un lotto (timestamp inizio) ────────
      // Restituisce un draft_id per il client. Il vero lotto viene creato
      // alla chiusura (action prod-finish) per evitare orfani in caso di abbandono.
      case 'prod-start': {
        const { pin, locale, recipe_id } = req.body;
        const v = await verifyPin(pin, 'produzione');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!locale || !recipe_id) return res.status(400).json({ error: 'locale e recipe_id richiesti' });
        const recs = await sbQuery(`production_recipes?id=eq.${recipe_id}&user_id=eq.${v.emp.user_id}&select=*&limit=1`);
        if (!recs?.[0]) return res.status(404).json({ error: 'Scheda non trovata' });
        // Il draft non viene salvato in DB: restituiamo il timestamp e basta
        return res.status(200).json({
          recipe: recs[0],
          data_inizio: new Date().toISOString(),
        });
      }

      // ─── PRODUZIONE MOBILE: chiudi lotto (crea batch + movimenti) ────
      case 'prod-finish': {
        const { pin, locale, recipe_id, manual_article_id, data_inizio, quantita_prodotta, ingredienti_effettivi,
                checklist_haccp, foto_url, note } = req.body;
        const v = await verifyPin(pin, 'produzione');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if ((!recipe_id && !manual_article_id) || !quantita_prodotta) {
          return res.status(400).json({ error: 'recipe_id (o manual_article_id) + quantita_prodotta richiesti' });
        }

        let recipe;
        if (recipe_id) {
          const recs = await sbQuery(`production_recipes?id=eq.${recipe_id}&user_id=eq.${v.emp.user_id}&select=*&limit=1`);
          if (!recs?.[0]) return res.status(404).json({ error: 'Scheda non trovata' });
          recipe = recs[0];
        } else {
          // Adatto un manual_article come "scheda virtuale"
          const sas = await sbQuery(`manual_articles?id=eq.${manual_article_id}&user_id=eq.${v.emp.user_id}&select=*&limit=1`);
          if (!sas?.[0]) return res.status(404).json({ error: 'Semilavorato non trovato' });
          const s = sas[0];
          recipe = {
            id: null,
            nome: s.nome,
            ingredienti: Array.isArray(s.ingredienti) ? s.ingredienti : [],
            resa_quantita: Number(s.resa) || 1,
            resa_unita: s.unita || null,
            allergeni: [],
            conservazione: null,
            shelf_life_days: null,
            locale_destinazione: locale,
            checklist_haccp_template: [],
          };
        }

        // Verifica checklist required
        const checklistTpl = Array.isArray(recipe.checklist_haccp_template) ? recipe.checklist_haccp_template : [];
        const ans = checklist_haccp || {};
        for (const it of checklistTpl) {
          if (it.required && (ans[it.id] == null || ans[it.id] === '')) {
            return res.status(400).json({ error: `Checklist HACCP non compilata: ${it.label}` });
          }
        }

        // Genera codice lotto univoco (P-YYYYMMDD-NNN per user)
        const today = new Date();
        const yyyymmdd = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
        const prefix = `P-${yyyymmdd}`;
        const last = await sbQuery(`production_batches?user_id=eq.${v.emp.user_id}&lotto=like.${prefix}%25&select=lotto&order=lotto.desc&limit=1`);
        let next = 1;
        if (last?.[0]?.lotto) { const m = last[0].lotto.match(/-(\d+)$/); if (m) next = Number(m[1]) + 1; }
        const lotto = `${prefix}-${String(next).padStart(3, '0')}`;

        // Calcola scadenza
        let scadenza = null;
        if (recipe.shelf_life_days) {
          const sc = new Date(); sc.setDate(sc.getDate() + Number(recipe.shelf_life_days));
          scadenza = sc.toISOString().slice(0, 10);
        }

        // Durata
        const dataInizio = data_inizio || new Date().toISOString();
        const dataFine = new Date().toISOString();
        const durataMin = Math.max(0, Math.round((new Date(dataFine) - new Date(dataInizio)) / 60000));

        // Ingredienti usati (effettivi se forniti, altrimenti scalati dalla ricetta)
        const ratio = recipe.resa_quantita ? Number(quantita_prodotta) / Number(recipe.resa_quantita) : 1;
        const ingredientiUsati = (ingredienti_effettivi && ingredienti_effettivi.length > 0)
          ? ingredienti_effettivi
          : (Array.isArray(recipe.ingredienti) ? recipe.ingredienti : []).map(i => ({
              nome_articolo: i.nome_articolo,
              quantita: Math.round((Number(i.quantita) || 0) * ratio * 1000) / 1000,
              unita: i.unita || '',
            }));

        // Insert batch (recipe_id può essere null se la produzione viene da un semilavorato)
        const batchRow = {
          user_id: v.emp.user_id,
          recipe_id: recipe_id || null,
          lotto,
          data_produzione: today.toISOString().slice(0, 10),
          ora_produzione: today.toTimeString().slice(0, 8),
          data_scadenza: scadenza,
          locale_produzione: locale,
          locale_destinazione: recipe.locale_destinazione || locale,
          operatore_id: v.emp.id,
          operatore_nome: v.emp.nome,
          quantita_prodotta: Number(quantita_prodotta),
          unita: recipe.resa_unita || null,
          ingredienti_usati: ingredientiUsati,
          allergeni: recipe.allergeni || [],
          conservazione: recipe.conservazione || null,
          note: note || null,
          stato: 'attivo',
          data_inizio: dataInizio,
          data_fine: dataFine,
          durata_minuti: durataMin,
          foto_url: foto_url || null,
          ingredienti_effettivi: ingredienti_effettivi || null,
          checklist_haccp: ans,
          da_mobile: true,
        };
        const insRes = await sbQuery('production_batches', 'POST', [batchRow]);
        const batch = Array.isArray(insRes) && insRes[0] ? insRes[0] : null;

        // Movimenti magazzino (best-effort, errori solo loggati)
        try {
          // Scarico ingredienti
          for (const ing of ingredientiUsati) {
            if (!ing.nome_articolo || !ing.quantita) continue;
            const movRows = [{
              user_id: v.emp.user_id, locale, sub_location: 'principale',
              nome_articolo: ing.nome_articolo, tipo: 'scarico',
              quantita: Number(ing.quantita), unita: ing.unita || null,
              fonte: 'produzione', riferimento_id: batch?.id || null,
              riferimento_label: `Produzione ${recipe.nome} · lotto ${lotto}`,
              production_batch_id: batch?.id || null,
            }];
            await sbQuery('article_movement', 'POST', movRows);
          }
          // Carico prodotto finito
          const localeFinale = recipe.locale_destinazione || locale;
          await sbQuery('article_movement', 'POST', [{
            user_id: v.emp.user_id, locale: localeFinale, sub_location: 'principale',
            nome_articolo: recipe.nome, tipo: 'carico',
            quantita: Number(quantita_prodotta), unita: recipe.resa_unita || null,
            fonte: 'produzione', riferimento_id: batch?.id || null,
            riferimento_label: `Lotto ${lotto}`,
            production_batch_id: batch?.id || null,
          }]);
        } catch (e) { console.error('[prod-finish movements]', e?.message || e); }

        return res.status(201).json({ ok: true, lotto, batch_id: batch?.id, durata_minuti: durataMin });
      }

      // ─── INFO PERSONALI (sola lettura, richiede solo PIN valido) ──

      // Turni settimanali del dipendente (employee_shifts)
      case 'my-shifts': {
        const v = await verifyPin(req.body?.pin, null);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const shifts = await sbQuery(`employee_shifts?employee_id=eq.${v.emp.id}&order=settimana.desc&select=*&limit=12`);
        return res.status(200).json({ shifts: shifts || [] });
      }

      // Statistiche ore lavorate (da attendance) — oggi / settimana / mese / anno
      case 'my-hours': {
        const v = await verifyPin(req.body?.pin, null);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const now = new Date();
        const yearStart = `${now.getFullYear()}-01-01`;
        const records = await sbQuery(`attendance?employee_id=eq.${v.emp.id}&timestamp=gte.${yearStart}T00:00:00&order=timestamp&select=timestamp,tipo,locale&limit=5000`);
        // Raggruppa per giorno operativo (cutoff 05:00 come altrove)
        const dayKey = (ts) => {
          try {
            const d = new Date(ts);
            const local = d.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' });
            const datePart = local.substring(0, 10);
            const hour = parseInt(local.substring(11, 13)) || 0;
            if (hour < 5) {
              const [y, m, dd] = datePart.split('-').map(Number);
              const prev = new Date(y, m - 1, dd - 1);
              return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0') + '-' + String(prev.getDate()).padStart(2, '0');
            }
            return datePart;
          } catch { return (ts || '').substring(0, 10); }
        };
        const byDay = {};
        (records || []).forEach(r => {
          const k = dayKey(r.timestamp);
          if (!byDay[k]) byDay[k] = [];
          byDay[k].push(r);
        });
        let todayH = 0, weekH = 0, monthH = 0, yearH = 0;
        const today = now.toISOString().substring(0, 10);
        // Lunedi corrente (ISO: giorno 1 = lunedi, 0 = domenica)
        const d0 = new Date(now); const dow = d0.getDay() || 7;
        d0.setDate(d0.getDate() - (dow - 1));
        const weekStart = d0.toISOString().substring(0, 10);
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const days = [];
        Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30).forEach(([day, recs]) => {
          const sorted = [...recs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
          let entrata = null, hours = 0;
          for (const r of sorted) {
            if (r.tipo === 'entrata') entrata = r.timestamp;
            else if (r.tipo === 'uscita' && entrata) { hours += (new Date(r.timestamp) - new Date(entrata)) / 3600000; entrata = null; }
          }
          hours = Math.round(hours * 10) / 10;
          days.push({ day, hours, locali: [...new Set(sorted.map(r => r.locale).filter(Boolean))] });
          if (day === today) todayH += hours;
          if (day >= weekStart) weekH += hours;
          if (day >= monthStart) monthH += hours;
          yearH += hours;
        });
        return res.status(200).json({
          today: Math.round(todayH * 10) / 10,
          week: Math.round(weekH * 10) / 10,
          month: Math.round(monthH * 10) / 10,
          year: Math.round(yearH * 10) / 10,
          oreContrattuali: null, // non presente sempre in employees, si potrebbe aggiungere
          days,
        });
      }

      // Ferie: approvate + richieste + calcolo giorni residui
      case 'my-timeoff': {
        const v = await verifyPin(req.body?.pin, null);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const emps = await sbQuery(`employees?id=eq.${v.emp.id}&select=ore_contrattuali,data_assunzione&limit=1`);
        const oreSett = Number(emps?.[0]?.ore_contrattuali || 40);
        const giorniAnnoCCNL = 26; // CCNL ristorazione: 26 giorni ferie/anno
        const all = await sbQuery(`employee_time_off?employee_id=eq.${v.emp.id}&order=data_inizio.desc&select=*`);
        // Calcolo ore ferie usate nell'anno corrente
        const yearStart = new Date().getFullYear() + '-01-01';
        const ferieUsate = (all || [])
          .filter(t => t.tipo === 'ferie' && t.stato === 'approvato' && (t.data_inizio || '') >= yearStart)
          .reduce((s, t) => s + (Number(t.ore) || 0), 0);
        const permessiUsati = (all || [])
          .filter(t => t.tipo === 'permesso' && t.stato === 'approvato' && (t.data_inizio || '') >= yearStart)
          .reduce((s, t) => s + (Number(t.ore) || 0), 0);
        const oreFerieAnno = (oreSett / 5) * giorniAnnoCCNL; // ore giornaliere medie × giorni anno
        const giorniFerieResidui = Math.max(0, Math.round((oreFerieAnno - ferieUsate) / (oreSett / 5) * 10) / 10);
        return res.status(200).json({
          oreContrattualiSettimanali: oreSett,
          ferieUsateOre: ferieUsate,
          permessiUsatiOre: permessiUsati,
          ferieResiduiGiorni: giorniFerieResidui,
          ferieResiduiOre: Math.max(0, Math.round((oreFerieAnno - ferieUsate) * 10) / 10),
          registro: all || [],
        });
      }

      // Storico timbrature di oggi per un dipendente
      case 'history': {
        const { pin, locale } = req.body || req.query;
        if (!pin) return res.status(400).json({ error: 'pin richiesto' });

        const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome`);
        if (!emps?.length) return res.status(404).json({ error: 'PIN non trovato' });

        const today = new Date().toISOString().split('T')[0];
        const records = await sbQuery(`attendance?employee_id=eq.${emps[0].id}&timestamp=gte.${today}T00:00:00&order=timestamp.desc&limit=20`);

        return res.status(200).json({ records: records || [] });
      }

      default:
        return res.status(400).json({ error: 'action richiesta: verify, timbra, history, recipes, consumo, articles, trasferimento, inv-open, inv-articles, inv-count, inv-add-article, inv-close, checklist-submit, checklist-response, checklist-skip, prod-recipes, prod-articles, prod-recipe-create, manual-article-create, prod-start, prod-finish, my-shifts, my-hours, my-timeoff' });
    }
  } catch (err) {
    console.error('[ATTENDANCE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
