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

async function appendToSheet(locale, row) {
  const sheetId = SHEETS[locale];
  if (!sheetId || !GOOGLE_CREDS.private_key) return;
  try {
    const auth = new GoogleAuth({ credentials: GOOGLE_CREDS, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:F:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    });
  } catch (e) { console.error('[SHEETS]', e.message); }
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

        return res.status(200).json({
          employee: { id: emp.id, nome: emp.nome, ruolo: emp.ruolo, locale: emp.locale, stato: emp.stato },
          permissions: emp.permissions || { presenza: true, inventario: false, spostamenti: false, consumo: false },
          lastTipo, suggestedTipo, lastTimestamp: last?.[0]?.timestamp,
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
        const stock = await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(locale)}&select=id,nome_articolo,unita,quantita,prezzo_medio,magazzino`);
        const invs = await sbQuery(`warehouse_invoices?locale=eq.${encodeURIComponent(locale)}&user_id=eq.${v.emp.user_id}&select=id`);
        const invIds = (invs || []).map(x => x.id);
        let invoiceArts = [];
        if (invIds.length > 0) {
          invoiceArts = await sbQuery(`warehouse_invoice_items?invoice_id=in.(${invIds.join(',')})&escludi_magazzino=eq.false&nome_articolo=not.is.null&select=nome_articolo,unita,magazzino`);
        }
        // Unione per nome_articolo; stock ha priorita' (ha giacenza e prezzo_medio)
        const byName = {};
        (stock || []).forEach(s => {
          if (!s.nome_articolo) return;
          byName[s.nome_articolo] = {
            nome_articolo: s.nome_articolo, unita: s.unita || '',
            quantita: Number(s.quantita || 0),
            prezzo_medio: s.prezzo_medio || null,
            magazzino: s.magazzino || null,
            stock_id: s.id,
          };
        });
        (invoiceArts || []).forEach(it => {
          const n = (it.nome_articolo || '').trim();
          if (!n) return;
          if (byName[n]) {
            // Se stock non ha magazzino ma la fattura sì, completiamo
            if (!byName[n].magazzino && it.magazzino) byName[n].magazzino = it.magazzino;
            return;
          }
          byName[n] = { nome_articolo: n, unita: it.unita || '', quantita: 0, prezzo_medio: null, magazzino: it.magazzino || null, stock_id: null };
        });
        const rows = Object.values(byName).sort((a, b) => a.nome_articolo.localeCompare(b.nome_articolo));

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
        const { pin, inventory_id } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!inventory_id) return res.status(400).json({ error: 'inventory_id richiesto' });
        const invs = await sbQuery(`warehouse_inventories?id=eq.${inventory_id}&select=*&limit=1`);
        if (!invs?.[0]) return res.status(404).json({ error: 'Inventario non trovato' });
        const inv = invs[0];
        const items = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${inventory_id}&select=*`);
        // Lookup magazzino per ogni articolo: priorità a `meta.magazzino` (salvato in inv-open),
        // fallback su article_stock del locale (per inventari già aperti senza magazzino in note),
        // ulteriore fallback su warehouse_invoice_items.
        let invLocale = '';
        for (const it of (items || [])) {
          try { invLocale = JSON.parse(it.note || '{}').locale || ''; if (invLocale) break } catch {}
        }
        const stocks = invLocale
          ? (await sbQuery(`article_stock?user_id=eq.${v.emp.user_id}&locale=eq.${encodeURIComponent(invLocale)}&select=nome_articolo,magazzino`)) || []
          : [];
        const magByName = {};
        stocks.forEach(s => { if (s.nome_articolo && s.magazzino) magByName[s.nome_articolo] = s.magazzino });
        // Per articoli senza magazzino in stock, lookup da warehouse_invoice_items (locale del fattura)
        const invsLoc = invLocale
          ? (await sbQuery(`warehouse_invoices?locale=eq.${encodeURIComponent(invLocale)}&user_id=eq.${v.emp.user_id}&select=id`)) || []
          : [];
        if (invsLoc.length > 0) {
          const invIds = invsLoc.map(x => x.id);
          const itemsInv = await sbQuery(`warehouse_invoice_items?invoice_id=in.(${invIds.join(',')})&nome_articolo=not.is.null&magazzino=not.is.null&select=nome_articolo,magazzino`);
          (itemsInv || []).forEach(it => {
            if (it.nome_articolo && it.magazzino && !magByName[it.nome_articolo]) {
              magByName[it.nome_articolo] = it.magazzino;
            }
          });
        }
        const mapped = (items || []).map(it => {
          let meta = {};
          try { meta = JSON.parse(it.note || '{}'); } catch {}
          const nome = meta.nome_articolo || '';
          return {
            id: it.id,
            nome_articolo: nome,
            unita: meta.unita || '',
            giacenza_teorica: Number(it.giacenza_teorica || 0),
            giacenza_reale: it.giacenza_reale,
            prezzo_medio: meta.prezzo_medio || null,
            magazzino: meta.magazzino || magByName[nome] || null,
          };
        }).filter(x => x.nome_articolo).sort((a, b) => a.nome_articolo.localeCompare(b.nome_articolo));
        return res.status(200).json({ inventory: inv, items: mapped });
      }

      case 'inv-count': {
        const { pin, inventory_id, nome_articolo, giacenza_reale } = req.body;
        const v = await verifyPin(pin, 'inventario');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!inventory_id || !nome_articolo || giacenza_reale == null) return res.status(400).json({ error: 'inventory_id, nome_articolo, giacenza_reale richiesti' });
        // Trova la riga cercando nel JSON note
        const items = await sbQuery(`warehouse_inventory_items?inventory_id=eq.${inventory_id}&select=id,giacenza_teorica,note`);
        const match = (items || []).find(it => { try { return JSON.parse(it.note || '{}').nome_articolo === nome_articolo; } catch { return false; } });
        if (!match) return res.status(404).json({ error: 'Riga inventario non trovata per ' + nome_articolo });
        const real = Number(giacenza_reale);
        const diff = real - Number(match.giacenza_teorica || 0);
        await sbQuery(`warehouse_inventory_items?id=eq.${match.id}`, 'PATCH', {
          giacenza_reale: real, differenza: diff,
        });
        return res.status(200).json({ ok: true });
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

        // Scrivi su Google Sheets
        const now = new Date();
        const data = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const ora = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
        appendToSheet(locale, [data, ora, emp.nome, tipo, '', locale]);

        return res.status(201).json({ ok: true, nome: emp.nome, tipo, distanza, timestamp: now.toISOString() });
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
        return res.status(400).json({ error: 'action richiesta: verify, timbra, history, recipes, consumo, articles, trasferimento, inv-open, inv-articles, inv-count, inv-close, my-shifts, my-hours, my-timeoff' });
    }
  } catch (err) {
    console.error('[ATTENDANCE]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
