// Modulo Task — endpoint mobile (/timbra) PIN-based + generazione ricorrenze.
// Pattern coerente con /api/attendance.js: service key + verifyPin + actions switch.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://afdochrjbmxnhviidzpb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZG9jaHJqYm14bmh2aWlkenBiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkzMzk5MSwiZXhwIjoyMDkwNTA5OTkxfQ.odgLZGS_W1j5mSngmL3MGlJOKTzfAm3RjsdXhi5MEEA';

async function sbQuery(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } };
  if (body) opts.body = JSON.stringify(body);
  if (method === 'POST' || method === 'PATCH') opts.headers['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  if (method === 'GET') return res.json();
  return res;
}

async function verifyPin(pin, perm) {
  if (!pin) return { error: 'pin richiesto', code: 400 };
  const emps = await sbQuery(`employees?pin=eq.${pin}&select=id,nome,user_id,stato,permissions,locale,manager_id,role`);
  if (!emps?.length) return { error: 'PIN non trovato', code: 404 };
  const emp = emps[0];
  if (emp.stato !== 'Attivo') return { error: 'Dipendente non attivo', code: 403 };
  if (perm) {
    const perms = emp.permissions || {};
    if (!perms[perm]) return { error: 'Permesso "' + perm + '" non autorizzato', code: 403 };
  }
  return { emp };
}

// Determina i locali del dipendente (può lavorare su più locali separati da virgola)
function empLocali(emp) {
  return (emp.locale || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Carica i sottoposti diretti di un employee_id
async function getSubordinates(userId, managerId) {
  return sbQuery(`employees?user_id=eq.${userId}&manager_id=eq.${managerId}&stato=eq.Attivo&select=id,nome,role,locale&order=nome`);
}

// Filtra le task visibili a un dipendente: assegnate a lui + team del suo locale + ruoli compatibili
function filterVisibleTasks(tasks, emp) {
  const locali = empLocali(emp);
  const role = emp.role || '';
  return (tasks || []).filter(t => {
    if (locali.length && t.locale && !locali.includes(t.locale)) return false;
    if (t.assignment_kind === 'persons') {
      const ids = Array.isArray(t.assigned_employee_ids) ? t.assigned_employee_ids : [];
      return ids.includes(emp.id);
    }
    if (t.assignment_kind === 'team') return true;
    if (t.assignment_kind === 'roles') {
      const roles = Array.isArray(t.assigned_roles) ? t.assigned_roles : [];
      return role && roles.includes(role);
    }
    return false;
  });
}

// Genera istanze tasks da template attivi fino a "until" (default +14gg).
async function generateFromTemplates(userId, untilDate) {
  const today = new Date().toISOString().split('T')[0];
  const until = untilDate || (() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().split('T')[0]; })();
  const templates = await sbQuery(`task_templates?user_id=eq.${userId}&active=eq.true&select=*`);
  if (!templates?.length) return { generated: 0 };

  const startDate = new Date(today);
  const endDate = new Date(until);
  const inserts = [];

  for (const tpl of templates) {
    const lastGen = tpl.last_generated_until ? new Date(tpl.last_generated_until) : null;
    const fromDate = lastGen && lastGen > startDate ? new Date(lastGen.getTime() + 86400000) : startDate;

    for (let d = new Date(fromDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay(); // 0=dom,1=lun..6=sab
      let match = false;
      switch (tpl.recurrence) {
        case 'daily': match = true; break;
        case 'weekdays': match = dow >= 1 && dow <= 5; break;
        case 'weekly': match = Array.isArray(tpl.days_of_week) && tpl.days_of_week.includes(dow); break;
        case 'biweekly': {
          if (Array.isArray(tpl.days_of_week) && tpl.days_of_week.includes(dow)) {
            const weekNum = Math.floor((d - new Date(2026, 0, 5)) / (7 * 86400000));
            match = weekNum % 2 === 0;
          }
          break;
        }
        case 'monthly': match = d.getDate() === (tpl.day_of_month || 1); break;
      }
      if (!match) continue;
      const dueDate = d.toISOString().split('T')[0];
      inserts.push({
        user_id: userId, locale: tpl.locale, sub_location: tpl.sub_location || 'principale',
        title: tpl.title, description: tpl.description, instructions: tpl.instructions,
        type: tpl.type, priority: tpl.priority, status: 'da_fare',
        assignment_kind: tpl.assignment_kind,
        assigned_employee_ids: tpl.assigned_employee_ids || [],
        assigned_roles: tpl.assigned_roles || [],
        due_date: dueDate, due_time: tpl.default_time, duration_min: tpl.default_duration_min,
        template_id: tpl.id,
        production_recipe_id: tpl.production_recipe_id,
        production_qty: tpl.production_qty,
        production_unit: tpl.production_unit,
        requires_photo: tpl.requires_photo,
      });
    }
  }
  // Inserisci una a una con on-conflict do nothing (UNIQUE template_id+due_date)
  let count = 0;
  for (const row of inserts) {
    const r = await sbQuery('tasks?on_conflict=template_id,due_date', 'POST', row);
    if (r.ok || r.status === 201) count++;
  }
  // Aggiorna last_generated_until su tutti i template processati
  for (const tpl of templates) {
    await sbQuery(`task_templates?id=eq.${tpl.id}`, 'PATCH', { last_generated_until: until });
  }
  return { generated: count, until };
}

// Upload foto base64 al bucket task-photos. Ritorna URL pubblico.
async function uploadPhoto(userId, taskId, base64) {
  if (!base64) return null;
  const matches = base64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!matches) throw new Error('Formato foto non valido (atteso data:image/...;base64,...)');
  const mime = matches[1];
  const ext = mime.split('/')[1] || 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  const path = `${userId}/${taskId}/${Date.now()}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/task-photos/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': mime, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'x-upsert': 'true' },
    body: buffer,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Upload foto fallito: ' + txt);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/task-photos/${path}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.body || req.query || {};

  try {
    switch (action) {

      // Verifica PIN, ritorna info dipendente + permessi task
      case 'verify': {
        const v = await verifyPin(req.body?.pin);
        if (v.error) return res.status(v.code).json({ error: v.error });
        return res.status(200).json({
          employee: v.emp,
          can_create: !!v.emp.permissions?.task_create,
          can_dispatch: !!v.emp.permissions?.task_dispatch,
        });
      }

      // Lista task del dipendente (proprie + team del locale + ruoli compatibili)
      // Range: oggi - +30gg (configurable via from/to)
      case 'list': {
        const { pin, from, to, scope } = req.body;
        const v = await verifyPin(pin);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const fromD = from || new Date().toISOString().split('T')[0];
        const toD = to || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; })();

        // scope='subordinates' → lista task dei sottoposti (per responsabili)
        if (scope === 'subordinates') {
          if (!v.emp.permissions?.task_create && !v.emp.permissions?.task_dispatch) {
            return res.status(403).json({ error: 'Permesso non sufficiente' });
          }
          const subs = await getSubordinates(v.emp.user_id, v.emp.id);
          const subIds = (subs || []).map(s => s.id);
          if (!subIds.length) return res.status(200).json({ tasks: [], subordinates: [] });
          const tasks = await sbQuery(`tasks?user_id=eq.${v.emp.user_id}&due_date=gte.${fromD}&due_date=lte.${toD}&order=due_date,due_time&select=*`);
          // Filtra task assegnate a un sottoposto
          const filtered = (tasks || []).filter(t => {
            if (t.assignment_kind === 'persons') {
              return (t.assigned_employee_ids || []).some(id => subIds.includes(id));
            }
            return false;
          });
          return res.status(200).json({ tasks: filtered, subordinates: subs });
        }

        const tasks = await sbQuery(`tasks?user_id=eq.${v.emp.user_id}&due_date=gte.${fromD}&due_date=lte.${toD}&order=due_date,due_time&select=*`);
        const visible = filterVisibleTasks(tasks, v.emp);
        return res.status(200).json({ tasks: visible });
      }

      // Dettaglio task singolo (con info sub-task se delegata + ricetta se produzione)
      case 'detail': {
        const { pin, task_id } = req.body;
        const v = await verifyPin(pin);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const tasks = await sbQuery(`tasks?id=eq.${task_id}&user_id=eq.${v.emp.user_id}&select=*&limit=1`);
        if (!tasks?.[0]) return res.status(404).json({ error: 'Task non trovata' });
        const t = tasks[0];
        // Sub-task se esiste delega
        const subTasks = await sbQuery(`tasks?parent_task_id=eq.${task_id}&select=id,title,status,assigned_employee_ids,completed_at,completed_by_id`);
        // Ricetta se produzione
        let recipe = null;
        if (t.type === 'production' && t.production_recipe_id) {
          const recs = await sbQuery(`recipes?id=eq.${t.production_recipe_id}&select=id,nome_prodotto,reparto,prezzo_vendita,ingredienti&limit=1`);
          recipe = recs?.[0] || null;
        }
        // Foto in firmato/pubblico se presente
        return res.status(200).json({ task: t, sub_tasks: subTasks || [], recipe });
      }

      // Avvia task (mette in_corso)
      case 'start': {
        const { pin, task_id } = req.body;
        const v = await verifyPin(pin);
        if (v.error) return res.status(v.code).json({ error: v.error });
        await sbQuery(`tasks?id=eq.${task_id}&user_id=eq.${v.emp.user_id}`, 'PATCH', {
          status: 'in_corso', updated_at: new Date().toISOString(),
        });
        return res.status(200).json({ ok: true });
      }

      // Completa task (foto obbligatoria se requires_photo=true)
      case 'complete': {
        const { pin, task_id, notes, photo_base64 } = req.body;
        const v = await verifyPin(pin);
        if (v.error) return res.status(v.code).json({ error: v.error });

        const tasks = await sbQuery(`tasks?id=eq.${task_id}&user_id=eq.${v.emp.user_id}&select=*&limit=1`);
        if (!tasks?.[0]) return res.status(404).json({ error: 'Task non trovata' });
        const t = tasks[0];
        if (t.status === 'fatta') return res.status(400).json({ error: 'Task già completata' });
        if (t.requires_photo && !photo_base64) return res.status(400).json({ error: 'Foto obbligatoria per questa task' });

        let photoUrl = null;
        if (photo_base64) photoUrl = await uploadPhoto(v.emp.user_id, task_id, photo_base64);

        await sbQuery(`tasks?id=eq.${task_id}`, 'PATCH', {
          status: 'fatta',
          completed_at: new Date().toISOString(),
          completed_by_id: v.emp.id,
          completion_notes: notes || null,
          completion_photo_url: photoUrl,
          updated_at: new Date().toISOString(),
        });

        // Se è una sub-task, controlla se tutti i fratelli sono completati → marca padre
        if (t.parent_task_id) {
          const siblings = await sbQuery(`tasks?parent_task_id=eq.${t.parent_task_id}&select=id,status`);
          const allDone = (siblings || []).every(s => s.id === task_id || s.status === 'fatta');
          if (allDone) {
            await sbQuery(`tasks?id=eq.${t.parent_task_id}`, 'PATCH', {
              status: 'fatta',
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        }

        return res.status(200).json({ ok: true, photo_url: photoUrl });
      }

      // Crea nuova task (richiede permesso task_create)
      case 'create': {
        const { pin, task } = req.body;
        const v = await verifyPin(pin, 'task_create');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!task || !task.title || !task.due_date || !task.assignment_kind) {
          return res.status(400).json({ error: 'title, due_date e assignment_kind richiesti' });
        }
        // Locale di default = primo locale del responsabile
        const locale = task.locale || empLocali(v.emp)[0] || null;
        const insert = {
          user_id: v.emp.user_id,
          locale,
          sub_location: task.sub_location || 'principale',
          title: task.title,
          description: task.description || null,
          instructions: task.instructions || null,
          type: task.type || 'generic',
          priority: task.priority || 'media',
          status: 'da_fare',
          assignment_kind: task.assignment_kind,
          assigned_employee_ids: task.assigned_employee_ids || [],
          assigned_roles: task.assigned_roles || [],
          assigned_by_id: v.emp.id,
          due_date: task.due_date,
          due_time: task.due_time || null,
          duration_min: task.duration_min || null,
          production_recipe_id: task.production_recipe_id || null,
          production_qty: task.production_qty || null,
          production_unit: task.production_unit || null,
          requires_photo: !!task.requires_photo,
        };
        const r = await sbQuery('tasks', 'POST', insert);
        if (!r.ok) {
          const txt = await r.text();
          return res.status(500).json({ error: 'Errore creazione: ' + txt });
        }
        const created = await r.json();
        return res.status(201).json({ ok: true, task: created?.[0] });
      }

      // Smistamento: crea N task figlie su sottoposti, marca padre come delegata
      case 'dispatch': {
        const { pin, task_id, employee_ids, override } = req.body;
        const v = await verifyPin(pin, 'task_dispatch');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!task_id || !Array.isArray(employee_ids) || employee_ids.length === 0) {
          return res.status(400).json({ error: 'task_id e employee_ids richiesti' });
        }

        const tasks = await sbQuery(`tasks?id=eq.${task_id}&user_id=eq.${v.emp.user_id}&select=*&limit=1`);
        if (!tasks?.[0]) return res.status(404).json({ error: 'Task non trovata' });
        const parent = tasks[0];

        const childRows = employee_ids.map(empId => ({
          user_id: v.emp.user_id,
          locale: parent.locale, sub_location: parent.sub_location,
          title: (override?.title || parent.title),
          description: parent.description,
          instructions: override?.instructions || parent.instructions,
          type: parent.type, priority: override?.priority || parent.priority,
          status: 'da_fare',
          assignment_kind: 'persons',
          assigned_employee_ids: [empId],
          assigned_by_id: v.emp.id,
          due_date: override?.due_date || parent.due_date,
          due_time: override?.due_time || parent.due_time,
          duration_min: parent.duration_min,
          parent_task_id: task_id,
          production_recipe_id: parent.production_recipe_id,
          production_qty: parent.production_qty,
          production_unit: parent.production_unit,
          requires_photo: parent.requires_photo,
        }));
        const r = await sbQuery('tasks', 'POST', childRows);
        if (!r.ok) {
          const txt = await r.text();
          return res.status(500).json({ error: 'Errore smistamento: ' + txt });
        }
        await sbQuery(`tasks?id=eq.${task_id}`, 'PATCH', {
          status: 'delegata', updated_at: new Date().toISOString(),
        });
        return res.status(201).json({ ok: true, count: employee_ids.length });
      }

      // Lista sottoposti (per UI smistamento/creazione)
      case 'subordinates': {
        const v = await verifyPin(req.body?.pin);
        if (v.error) return res.status(v.code).json({ error: v.error });
        const subs = await getSubordinates(v.emp.user_id, v.emp.id);
        return res.status(200).json({ subordinates: subs || [] });
      }

      // Lista modelli (knowledge base) per autocompila form
      case 'knowledge_list': {
        const v = await verifyPin(req.body?.pin, 'task_create');
        if (v.error) return res.status(v.code).json({ error: v.error });
        const list = await sbQuery(`task_knowledge?user_id=eq.${v.emp.user_id}&select=*&order=usage_count.desc,title.asc&limit=200`);
        return res.status(200).json({ knowledge: list || [] });
      }

      // Incrementa usage_count quando si usa un modello (chiamabile dopo create)
      case 'knowledge_use': {
        const { pin, knowledge_id } = req.body;
        const v = await verifyPin(pin, 'task_create');
        if (v.error) return res.status(v.code).json({ error: v.error });
        if (!knowledge_id) return res.status(400).json({ error: 'knowledge_id richiesto' });
        // Fetch attuale per incrementare (Supabase REST non supporta x = x + 1 senza RPC)
        const cur = await sbQuery(`task_knowledge?id=eq.${knowledge_id}&user_id=eq.${v.emp.user_id}&select=usage_count&limit=1`);
        const next = (Number(cur?.[0]?.usage_count) || 0) + 1;
        await sbQuery(`task_knowledge?id=eq.${knowledge_id}`, 'PATCH', { usage_count: next });
        return res.status(200).json({ ok: true, usage_count: next });
      }

      // Lista ricette del tenant (per task produzione)
      case 'recipes': {
        const v = await verifyPin(req.body?.pin, 'task_create');
        if (v.error) return res.status(v.code).json({ error: v.error });
        const recs = await sbQuery(`recipes?user_id=eq.${v.emp.user_id}&select=id,nome_prodotto,reparto&order=nome_prodotto&limit=500`);
        return res.status(200).json({ recipes: recs || [] });
      }

      // Genera istanze tasks da template attivi (chiamabile da admin, idempotente)
      case 'generate': {
        const { user_id, until } = req.body;
        if (!user_id) return res.status(400).json({ error: 'user_id richiesto' });
        const out = await generateFromTemplates(user_id, until);
        return res.status(200).json(out);
      }

      // Aggiorna campi di una task (limitato: il responsabile può modificare titolo, ora, priorità ecc.)
      case 'update': {
        const { pin, task_id, patch } = req.body;
        const v = await verifyPin(pin, 'task_create');
        if (v.error) return res.status(v.code).json({ error: v.error });
        const allowed = ['title','description','instructions','priority','due_date','due_time','duration_min','requires_photo','status'];
        const filtered = {};
        for (const k of allowed) if (k in (patch || {})) filtered[k] = patch[k];
        filtered.updated_at = new Date().toISOString();
        await sbQuery(`tasks?id=eq.${task_id}&user_id=eq.${v.emp.user_id}`, 'PATCH', filtered);
        return res.status(200).json({ ok: true });
      }

      // Elimina task (solo creator o admin)
      case 'delete': {
        const { pin, task_id } = req.body;
        const v = await verifyPin(pin, 'task_create');
        if (v.error) return res.status(v.code).json({ error: v.error });
        await sbQuery(`tasks?id=eq.${task_id}&user_id=eq.${v.emp.user_id}&assigned_by_id=eq.${v.emp.id}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Action non valida: ' + action });
    }
  } catch (e) {
    console.error('[/api/tasks]', e);
    return res.status(500).json({ error: e.message });
  }
}
