-- ============================================================
-- Audit Log: chi/quando/cosa fa lo staff sui dati dell'owner
-- ============================================================
-- Trigger su tutte le tabelle multi-tenant: cattura INSERT/UPDATE/DELETE.
-- Logga SOLO le azioni dello staff (auth.uid() != target user_id).
-- Le azioni dell'owner non vengono registrate per non sporcare il log.
--
-- ESEGUI QUESTO FILE SU SUPABASE SQL EDITOR DOPO supabase/staff-access.sql.
-- ============================================================

BEGIN;

-- 1) TABELLA audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,                 -- owner (per multi-tenant scope)
  actor_uid uuid,                         -- auth.uid() che ha eseguito
  actor_kind text NOT NULL DEFAULT 'staff', -- 'staff' (per ora solo questo)
  actor_employee_id uuid,                 -- id employee (per join ricco)
  actor_name text,                        -- snapshot nome (sopravvive a delete)
  table_name text NOT NULL,
  record_id text,                         -- pk del record toccato
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed jsonb,                          -- INSERT: row; UPDATE: { campo:[old,new] }; DELETE: row
  module_hint text,                       -- opzionale, futuro
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_ts_idx       ON public.audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_ts_idx      ON public.audit_log (actor_uid, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_employee_ts_idx   ON public.audit_log (actor_employee_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_table_record_idx  ON public.audit_log (table_name, record_id);

-- RLS: solo owner puo' leggere il proprio log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_owner" ON public.audit_log;
CREATE POLICY "audit_log_select_owner" ON public.audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- Insert sara' fatto SOLO dal trigger (security definer): nessuna policy INSERT
-- per il client. UPDATE/DELETE: vietati a tutti (log immutabile).

-- 2) FUNZIONE TRIGGER GENERICA
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_user_id uuid;
  v_actor_uid uuid;
  v_actor_emp_id uuid;
  v_actor_name text;
  v_changed jsonb;
  v_record_id text;
BEGIN
  v_actor_uid := auth.uid();
  -- Se nessun utente autenticato (es. service-role / cron), salta
  IF v_actor_uid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Determina il target user_id (owner della riga)
  IF TG_OP = 'DELETE' THEN
    v_target_user_id := OLD.user_id;
  ELSE
    v_target_user_id := NEW.user_id;
  END IF;
  IF v_target_user_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- SKIP se l'attore E' l'owner (solo staff viene loggato)
  IF v_actor_uid = v_target_user_id THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Trova il record employee dello staff (per nome snapshot)
  SELECT id, nome INTO v_actor_emp_id, v_actor_name
  FROM public.employees
  WHERE auth_user_id = v_actor_uid
  LIMIT 1;

  -- Se non e' staff registrato, salta (potrebbe essere un altro owner via service-role)
  IF v_actor_emp_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Calcola changed
  IF TG_OP = 'INSERT' THEN
    v_changed := to_jsonb(NEW);
    v_record_id := COALESCE((to_jsonb(NEW)->>'id')::text, NULL);
  ELSIF TG_OP = 'DELETE' THEN
    v_changed := to_jsonb(OLD);
    v_record_id := COALESCE((to_jsonb(OLD)->>'id')::text, NULL);
  ELSE -- UPDATE
    v_record_id := COALESCE((to_jsonb(NEW)->>'id')::text, NULL);
    -- Diff: { col: [old, new] } solo per colonne cambiate
    SELECT jsonb_object_agg(o.key, jsonb_build_array(o.value, n.value))
      INTO v_changed
      FROM jsonb_each(to_jsonb(OLD)) o
      JOIN jsonb_each(to_jsonb(NEW)) n ON o.key = n.key
     WHERE o.value IS DISTINCT FROM n.value
       AND o.key NOT IN ('updated_at','created_at'); -- escludi rumore timestamp
    -- Skip se nessun cambio significativo
    IF v_changed IS NULL OR v_changed = '{}'::jsonb THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO public.audit_log
    (user_id, actor_uid, actor_kind, actor_employee_id, actor_name, table_name, record_id, action, changed)
  VALUES
    (v_target_user_id, v_actor_uid, 'staff', v_actor_emp_id, v_actor_name, TG_TABLE_NAME, v_record_id, TG_OP, v_changed);

  RETURN COALESCE(NEW, OLD);
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_trigger_fn() TO authenticated;

-- 3) APPLICA TRIGGER SU TUTTE LE TABELLE MULTI-TENANT
-- Pattern: una funzione helper per evitare ripetizione

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'recipes',
    'manual_articles',
    'warehouse_invoices',
    'warehouse_invoice_items',
    'warehouse_products',
    'warehouse_locations',
    'warehouse_stock',
    'warehouse_movements',
    'warehouse_inventories',
    'warehouse_inventory_items',
    'warehouse_orders',
    'warehouse_order_items',
    'warehouse_recipes',
    'warehouse_recipe_items',
    'warehouse_prices',
    'warehouse_aliases',
    'production_recipes',
    'production_batches',
    'article_allergens',
    'item_rules',
    'attendance',
    'attendance_checklists',
    'attendance_checklist_responses',
    'employees',
    'employee_documents',
    'employee_pay_history',
    'employee_shifts',
    'employee_time_off',
    'calendar_events',
    'staff_schedules',
    'personnel_costs',
    'budget_periods',
    'budget_scenarios',
    'budget_rows',
    'tag_definitions',
    'customers',
    'customer_tags',
    'promotions',
    'promotion_redemptions',
    'fidelity_programs',
    'fidelity_rewards',
    'fidelity_movements',
    'manual_costs',
    'daily_report_settings',
    'alert_rules',
    'user_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Verifica che la tabella esista (alcune potrebbero non esistere in deploy minore)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_trg ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn()', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ============================================================
-- VERIFICA POST-MIGRAZIONE
-- ============================================================
-- 1) La tabella esiste:
--    SELECT count(*) FROM public.audit_log;
-- 2) I trigger sono installati:
--    SELECT event_object_table FROM information_schema.triggers
--    WHERE trigger_name = 'audit_trg' AND trigger_schema = 'public'
--    ORDER BY event_object_table;
-- 3) Test: con sessione staff, modifica una ricetta. Dovresti vedere una riga
--    in audit_log con action='UPDATE', table_name='recipes', changed={prezzo_vendita: [9, 10]}
--
-- ROLLBACK manuale se vuoi rimuovere tutto:
--   DROP TABLE public.audit_log CASCADE;
--   DROP FUNCTION public.audit_trigger_fn();
-- ============================================================
