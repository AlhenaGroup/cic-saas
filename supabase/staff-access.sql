-- ============================================================
-- Staff Access — accesso multi-utente alla dashboard
-- ============================================================
-- Estende il modello multi-tenant per permettere ai dipendenti
-- (employees) di loggarsi e accedere alla dashboard dell'imprenditore
-- (owner) con permessi granulari per modulo + sub-tab.
--
-- ESEGUI QUESTO FILE SU SUPABASE (SQL Editor) IN UN'UNICA TRANSAZIONE.
--
-- Convenzioni permessi:
--   employees.module_permissions e' jsonb con notazione dot-flat:
--     { "mag": "rw", "mag.fatture": "r", "hr.dip": "rw", "ov": "r" }
--   Valori: "rw" = read+write, "r" = sola lettura, null/assente = no.
--   Risoluzione: chiave "mod.subtab" ha precedenza su "mod".
-- ============================================================

BEGIN;

-- 1) SCHEMA: nuove colonne su employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS module_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS employees_auth_user_id_idx ON public.employees(auth_user_id);
CREATE INDEX IF NOT EXISTS employees_email_lower_idx ON public.employees(lower(email));


-- 2) FUNZIONE can_access(target_user_id, mod_subtab, need_write)
--    Ritorna true se l'utente corrente puo' accedere ai dati appartenenti
--    a target_user_id per il modulo/sub-tab specificato.
CREATE OR REPLACE FUNCTION public.can_access(
  target_user_id uuid,
  mod_subtab text,
  need_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  perm_value text;
  module_only text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  -- Owner: accesso totale
  IF auth.uid() = target_user_id THEN
    RETURN true;
  END IF;
  module_only := split_part(mod_subtab, '.', 1);
  SELECT
    COALESCE(
      e.module_permissions ->> mod_subtab,
      e.module_permissions ->> module_only
    )
    INTO perm_value
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.user_id = target_user_id
    AND e.stato = 'Attivo'
  LIMIT 1;
  IF perm_value IS NULL THEN RETURN false; END IF;
  IF need_write THEN RETURN perm_value = 'rw'; END IF;
  RETURN perm_value IN ('r', 'rw');
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access(uuid, text, boolean) TO authenticated, anon;


-- 3) Helper macro: definire policies SELECT/INSERT/UPDATE/DELETE basate su can_access
--    PostgreSQL non ha macro, quindi facciamo blocco DO con DROP+CREATE per ogni tabella.
--    Per chiarezza/manutenibilita' scriviamo esplicitamente.

-- ============================================================
-- 4) POLICY UPDATE PER OGNI TABELLA
-- ============================================================
-- Pattern:
--   DROP POLICY IF EXISTS old ON public.<tab>;
--   CREATE POLICY <name>_s ON public.<tab> FOR SELECT USING (can_access(user_id, '<mod.sub>', false));
--   CREATE POLICY <name>_i ON public.<tab> FOR INSERT WITH CHECK (can_access(user_id, '<mod.sub>', true));
--   CREATE POLICY <name>_u ON public.<tab> FOR UPDATE USING (can_access(user_id, '<mod.sub>', true)) WITH CHECK (can_access(user_id, '<mod.sub>', true));
--   CREATE POLICY <name>_d ON public.<tab> FOR DELETE USING (can_access(user_id, '<mod.sub>', true));

-- USER_SETTINGS: caso speciale. Owner = full. Staff = SELECT permesso (necessario al bootstrap),
-- UPDATE/INSERT/DELETE solo owner. Senza SELECT lo staff non puo' leggere cic_api_key/sales_points.
DROP POLICY IF EXISTS "own_user_settings" ON public.user_settings;
CREATE POLICY "us_select" ON public.user_settings FOR SELECT USING (
  auth.uid() = user_id OR EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.auth_user_id = auth.uid() AND e.user_id = user_settings.user_id AND e.stato = 'Attivo'
  )
);
CREATE POLICY "us_modify" ON public.user_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- GOOGLE_TOKENS, CATEGORY_MAPPINGS: solo owner (mai staff)
-- (lascio invariato, sono gia' su auth.uid()=user_id)
-- (item_rules, report_cache: gestiti sotto via mag.fatture/owner)

-- REPORT_CACHE: solo owner per ora
-- (lascia inalterata)

-- ITEM_RULES: condivise tra Magazzino fatture e Contabilita' fatture
DROP POLICY IF EXISTS "own_item_rules" ON public.item_rules;
CREATE POLICY "ir_s" ON public.item_rules FOR SELECT USING (can_access(user_id, 'mag.fatture', false) OR can_access(user_id, 'conta.fatture', false));
CREATE POLICY "ir_i" ON public.item_rules FOR INSERT WITH CHECK (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true));
CREATE POLICY "ir_u" ON public.item_rules FOR UPDATE USING (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true)) WITH CHECK (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true));
CREATE POLICY "ir_d" ON public.item_rules FOR DELETE USING (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true));

-- WAREHOUSE
DROP POLICY IF EXISTS "own_warehouse_products" ON public.warehouse_products;
CREATE POLICY "wp_s" ON public.warehouse_products FOR SELECT USING (can_access(user_id, 'mag.prodotti', false));
CREATE POLICY "wp_i" ON public.warehouse_products FOR INSERT WITH CHECK (can_access(user_id, 'mag.prodotti', true));
CREATE POLICY "wp_u" ON public.warehouse_products FOR UPDATE USING (can_access(user_id, 'mag.prodotti', true)) WITH CHECK (can_access(user_id, 'mag.prodotti', true));
CREATE POLICY "wp_d" ON public.warehouse_products FOR DELETE USING (can_access(user_id, 'mag.prodotti', true));

DROP POLICY IF EXISTS "own_warehouse_locations" ON public.warehouse_locations;
CREATE POLICY "wl_s" ON public.warehouse_locations FOR SELECT USING (can_access(user_id, 'mag.prodotti', false));
CREATE POLICY "wl_i" ON public.warehouse_locations FOR INSERT WITH CHECK (can_access(user_id, 'mag.prodotti', true));
CREATE POLICY "wl_u" ON public.warehouse_locations FOR UPDATE USING (can_access(user_id, 'mag.prodotti', true)) WITH CHECK (can_access(user_id, 'mag.prodotti', true));
CREATE POLICY "wl_d" ON public.warehouse_locations FOR DELETE USING (can_access(user_id, 'mag.prodotti', true));

DROP POLICY IF EXISTS "own_warehouse_stock" ON public.warehouse_stock;
CREATE POLICY "ws_s" ON public.warehouse_stock FOR SELECT USING (can_access(user_id, 'mag.giacenze', false));
CREATE POLICY "ws_i" ON public.warehouse_stock FOR INSERT WITH CHECK (can_access(user_id, 'mag.giacenze', true));
CREATE POLICY "ws_u" ON public.warehouse_stock FOR UPDATE USING (can_access(user_id, 'mag.giacenze', true)) WITH CHECK (can_access(user_id, 'mag.giacenze', true));
CREATE POLICY "ws_d" ON public.warehouse_stock FOR DELETE USING (can_access(user_id, 'mag.giacenze', true));

DROP POLICY IF EXISTS "own_warehouse_movements" ON public.warehouse_movements;
CREATE POLICY "wm_s" ON public.warehouse_movements FOR SELECT USING (can_access(user_id, 'mag.movimenti', false));
CREATE POLICY "wm_i" ON public.warehouse_movements FOR INSERT WITH CHECK (can_access(user_id, 'mag.movimenti', true));
CREATE POLICY "wm_u" ON public.warehouse_movements FOR UPDATE USING (can_access(user_id, 'mag.movimenti', true)) WITH CHECK (can_access(user_id, 'mag.movimenti', true));
CREATE POLICY "wm_d" ON public.warehouse_movements FOR DELETE USING (can_access(user_id, 'mag.movimenti', true));

-- WAREHOUSE_INVOICES: condivise tra Magazzino fatture e Contabilita' fatture
DROP POLICY IF EXISTS "own_warehouse_invoices" ON public.warehouse_invoices;
CREATE POLICY "wi_s" ON public.warehouse_invoices FOR SELECT USING (can_access(user_id, 'mag.fatture', false) OR can_access(user_id, 'conta.fatture', false));
CREATE POLICY "wi_i" ON public.warehouse_invoices FOR INSERT WITH CHECK (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true));
CREATE POLICY "wi_u" ON public.warehouse_invoices FOR UPDATE USING (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true)) WITH CHECK (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true));
CREATE POLICY "wi_d" ON public.warehouse_invoices FOR DELETE USING (can_access(user_id, 'mag.fatture', true) OR can_access(user_id, 'conta.fatture', true));

DROP POLICY IF EXISTS "own_warehouse_inventories" ON public.warehouse_inventories;
CREATE POLICY "wv_s" ON public.warehouse_inventories FOR SELECT USING (can_access(user_id, 'mag.inventario', false));
CREATE POLICY "wv_i" ON public.warehouse_inventories FOR INSERT WITH CHECK (can_access(user_id, 'mag.inventario', true));
CREATE POLICY "wv_u" ON public.warehouse_inventories FOR UPDATE USING (can_access(user_id, 'mag.inventario', true)) WITH CHECK (can_access(user_id, 'mag.inventario', true));
CREATE POLICY "wv_d" ON public.warehouse_inventories FOR DELETE USING (can_access(user_id, 'mag.inventario', true));

DROP POLICY IF EXISTS "own_warehouse_orders" ON public.warehouse_orders;
CREATE POLICY "wo_s" ON public.warehouse_orders FOR SELECT USING (can_access(user_id, 'mag.ordini', false));
CREATE POLICY "wo_i" ON public.warehouse_orders FOR INSERT WITH CHECK (can_access(user_id, 'mag.ordini', true));
CREATE POLICY "wo_u" ON public.warehouse_orders FOR UPDATE USING (can_access(user_id, 'mag.ordini', true)) WITH CHECK (can_access(user_id, 'mag.ordini', true));
CREATE POLICY "wo_d" ON public.warehouse_orders FOR DELETE USING (can_access(user_id, 'mag.ordini', true));

DROP POLICY IF EXISTS "own_warehouse_recipes" ON public.warehouse_recipes;
CREATE POLICY "wr_s" ON public.warehouse_recipes FOR SELECT USING (can_access(user_id, 'mag.ricette', false));
CREATE POLICY "wr_i" ON public.warehouse_recipes FOR INSERT WITH CHECK (can_access(user_id, 'mag.ricette', true));
CREATE POLICY "wr_u" ON public.warehouse_recipes FOR UPDATE USING (can_access(user_id, 'mag.ricette', true)) WITH CHECK (can_access(user_id, 'mag.ricette', true));
CREATE POLICY "wr_d" ON public.warehouse_recipes FOR DELETE USING (can_access(user_id, 'mag.ricette', true));

DROP POLICY IF EXISTS "own_recipes" ON public.recipes;
CREATE POLICY "rec_s" ON public.recipes FOR SELECT USING (can_access(user_id, 'mag.ricette', false));
CREATE POLICY "rec_i" ON public.recipes FOR INSERT WITH CHECK (can_access(user_id, 'mag.ricette', true));
CREATE POLICY "rec_u" ON public.recipes FOR UPDATE USING (can_access(user_id, 'mag.ricette', true)) WITH CHECK (can_access(user_id, 'mag.ricette', true));
CREATE POLICY "rec_d" ON public.recipes FOR DELETE USING (can_access(user_id, 'mag.ricette', true));

-- daily_report_settings → Impostazioni notifiche
DROP POLICY IF EXISTS "own_daily_report" ON public.daily_report_settings;
CREATE POLICY "drs_s" ON public.daily_report_settings FOR SELECT USING (can_access(user_id, 'imp.notifiche', false));
CREATE POLICY "drs_i" ON public.daily_report_settings FOR INSERT WITH CHECK (can_access(user_id, 'imp.notifiche', true));
CREATE POLICY "drs_u" ON public.daily_report_settings FOR UPDATE USING (can_access(user_id, 'imp.notifiche', true)) WITH CHECK (can_access(user_id, 'imp.notifiche', true));
CREATE POLICY "drs_d" ON public.daily_report_settings FOR DELETE USING (can_access(user_id, 'imp.notifiche', true));

-- ALERTS
DROP POLICY IF EXISTS "own_alert_rules" ON public.alert_rules;
CREATE POLICY "ar_s" ON public.alert_rules FOR SELECT USING (can_access(user_id, 'avvisi.config', false));
CREATE POLICY "ar_i" ON public.alert_rules FOR INSERT WITH CHECK (can_access(user_id, 'avvisi.config', true));
CREATE POLICY "ar_u" ON public.alert_rules FOR UPDATE USING (can_access(user_id, 'avvisi.config', true)) WITH CHECK (can_access(user_id, 'avvisi.config', true));
CREATE POLICY "ar_d" ON public.alert_rules FOR DELETE USING (can_access(user_id, 'avvisi.config', true));

DROP POLICY IF EXISTS "own_alert_events" ON public.alert_events;
CREATE POLICY "ae_s" ON public.alert_events FOR SELECT USING (can_access(user_id, 'avvisi.feed', false));
CREATE POLICY "ae_i" ON public.alert_events FOR INSERT WITH CHECK (can_access(user_id, 'avvisi.feed', true));
CREATE POLICY "ae_u" ON public.alert_events FOR UPDATE USING (can_access(user_id, 'avvisi.feed', true)) WITH CHECK (can_access(user_id, 'avvisi.feed', true));
CREATE POLICY "ae_d" ON public.alert_events FOR DELETE USING (can_access(user_id, 'avvisi.feed', true));

DROP POLICY IF EXISTS "own_article_allergens" ON public.article_allergens;
CREATE POLICY "aa_s" ON public.article_allergens FOR SELECT USING (can_access(user_id, 'mag.articoli', false));
CREATE POLICY "aa_i" ON public.article_allergens FOR INSERT WITH CHECK (can_access(user_id, 'mag.articoli', true));
CREATE POLICY "aa_u" ON public.article_allergens FOR UPDATE USING (can_access(user_id, 'mag.articoli', true)) WITH CHECK (can_access(user_id, 'mag.articoli', true));
CREATE POLICY "aa_d" ON public.article_allergens FOR DELETE USING (can_access(user_id, 'mag.articoli', true));

DROP POLICY IF EXISTS "own_production_recipes" ON public.production_recipes;
CREATE POLICY "pr_s" ON public.production_recipes FOR SELECT USING (can_access(user_id, 'mag.produzione', false));
CREATE POLICY "pr_i" ON public.production_recipes FOR INSERT WITH CHECK (can_access(user_id, 'mag.produzione', true));
CREATE POLICY "pr_u" ON public.production_recipes FOR UPDATE USING (can_access(user_id, 'mag.produzione', true)) WITH CHECK (can_access(user_id, 'mag.produzione', true));
CREATE POLICY "pr_d" ON public.production_recipes FOR DELETE USING (can_access(user_id, 'mag.produzione', true));

DROP POLICY IF EXISTS "own_production_batches" ON public.production_batches;
CREATE POLICY "pb_s" ON public.production_batches FOR SELECT USING (can_access(user_id, 'mag.produzione', false));
CREATE POLICY "pb_i" ON public.production_batches FOR INSERT WITH CHECK (can_access(user_id, 'mag.produzione', true));
CREATE POLICY "pb_u" ON public.production_batches FOR UPDATE USING (can_access(user_id, 'mag.produzione', true)) WITH CHECK (can_access(user_id, 'mag.produzione', true));
CREATE POLICY "pb_d" ON public.production_batches FOR DELETE USING (can_access(user_id, 'mag.produzione', true));

-- attendance_checklists / responses
DROP POLICY IF EXISTS "checklists_owner" ON public.attendance_checklists;
CREATE POLICY "ac_s" ON public.attendance_checklists FOR SELECT USING (can_access(user_id, 'hr.checklist', false));
CREATE POLICY "ac_i" ON public.attendance_checklists FOR INSERT WITH CHECK (can_access(user_id, 'hr.checklist', true));
CREATE POLICY "ac_u" ON public.attendance_checklists FOR UPDATE USING (can_access(user_id, 'hr.checklist', true)) WITH CHECK (can_access(user_id, 'hr.checklist', true));
CREATE POLICY "ac_d" ON public.attendance_checklists FOR DELETE USING (can_access(user_id, 'hr.checklist', true));

DROP POLICY IF EXISTS "responses_owner" ON public.attendance_checklist_responses;
CREATE POLICY "acr_s" ON public.attendance_checklist_responses FOR SELECT USING (can_access(user_id, 'hr.checklist', false));
CREATE POLICY "acr_i" ON public.attendance_checklist_responses FOR INSERT WITH CHECK (can_access(user_id, 'hr.checklist', true));
CREATE POLICY "acr_u" ON public.attendance_checklist_responses FOR UPDATE USING (can_access(user_id, 'hr.checklist', true)) WITH CHECK (can_access(user_id, 'hr.checklist', true));
CREATE POLICY "acr_d" ON public.attendance_checklist_responses FOR DELETE USING (can_access(user_id, 'hr.checklist', true));

-- HR
DROP POLICY IF EXISTS "own_employees" ON public.employees;
CREATE POLICY "emp_s" ON public.employees FOR SELECT USING (can_access(user_id, 'hr.dip', false) OR auth_user_id = auth.uid());
CREATE POLICY "emp_i" ON public.employees FOR INSERT WITH CHECK (can_access(user_id, 'hr.dip', true));
CREATE POLICY "emp_u" ON public.employees FOR UPDATE USING (can_access(user_id, 'hr.dip', true)) WITH CHECK (can_access(user_id, 'hr.dip', true));
CREATE POLICY "emp_d" ON public.employees FOR DELETE USING (can_access(user_id, 'hr.dip', true));

DROP POLICY IF EXISTS "own_employee_documents" ON public.employee_documents;
CREATE POLICY "ed_s" ON public.employee_documents FOR SELECT USING (can_access(user_id, 'hr.doc', false));
CREATE POLICY "ed_i" ON public.employee_documents FOR INSERT WITH CHECK (can_access(user_id, 'hr.doc', true));
CREATE POLICY "ed_u" ON public.employee_documents FOR UPDATE USING (can_access(user_id, 'hr.doc', true)) WITH CHECK (can_access(user_id, 'hr.doc', true));
CREATE POLICY "ed_d" ON public.employee_documents FOR DELETE USING (can_access(user_id, 'hr.doc', true));

DROP POLICY IF EXISTS "own_employee_pay_history" ON public.employee_pay_history;
CREATE POLICY "eph_s" ON public.employee_pay_history FOR SELECT USING (can_access(user_id, 'hr.dip', false));
CREATE POLICY "eph_i" ON public.employee_pay_history FOR INSERT WITH CHECK (can_access(user_id, 'hr.dip', true));
CREATE POLICY "eph_u" ON public.employee_pay_history FOR UPDATE USING (can_access(user_id, 'hr.dip', true)) WITH CHECK (can_access(user_id, 'hr.dip', true));
CREATE POLICY "eph_d" ON public.employee_pay_history FOR DELETE USING (can_access(user_id, 'hr.dip', true));

DROP POLICY IF EXISTS "own_employee_shifts" ON public.employee_shifts;
CREATE POLICY "es_s" ON public.employee_shifts FOR SELECT USING (can_access(user_id, 'hr.turni', false));
CREATE POLICY "es_i" ON public.employee_shifts FOR INSERT WITH CHECK (can_access(user_id, 'hr.turni', true));
CREATE POLICY "es_u" ON public.employee_shifts FOR UPDATE USING (can_access(user_id, 'hr.turni', true)) WITH CHECK (can_access(user_id, 'hr.turni', true));
CREATE POLICY "es_d" ON public.employee_shifts FOR DELETE USING (can_access(user_id, 'hr.turni', true));

DROP POLICY IF EXISTS "own_employee_time_off" ON public.employee_time_off;
CREATE POLICY "eto_s" ON public.employee_time_off FOR SELECT USING (can_access(user_id, 'hr.cal', false));
CREATE POLICY "eto_i" ON public.employee_time_off FOR INSERT WITH CHECK (can_access(user_id, 'hr.cal', true));
CREATE POLICY "eto_u" ON public.employee_time_off FOR UPDATE USING (can_access(user_id, 'hr.cal', true)) WITH CHECK (can_access(user_id, 'hr.cal', true));
CREATE POLICY "eto_d" ON public.employee_time_off FOR DELETE USING (can_access(user_id, 'hr.cal', true));

DROP POLICY IF EXISTS "own_calendar_events" ON public.calendar_events;
CREATE POLICY "ce_s" ON public.calendar_events FOR SELECT USING (can_access(user_id, 'hr.cal', false));
CREATE POLICY "ce_i" ON public.calendar_events FOR INSERT WITH CHECK (can_access(user_id, 'hr.cal', true));
CREATE POLICY "ce_u" ON public.calendar_events FOR UPDATE USING (can_access(user_id, 'hr.cal', true)) WITH CHECK (can_access(user_id, 'hr.cal', true));
CREATE POLICY "ce_d" ON public.calendar_events FOR DELETE USING (can_access(user_id, 'hr.cal', true));

DROP POLICY IF EXISTS "own_staff_schedules" ON public.staff_schedules;
CREATE POLICY "ss_s" ON public.staff_schedules FOR SELECT USING (can_access(user_id, 'hr.turni', false));
CREATE POLICY "ss_i" ON public.staff_schedules FOR INSERT WITH CHECK (can_access(user_id, 'hr.turni', true));
CREATE POLICY "ss_u" ON public.staff_schedules FOR UPDATE USING (can_access(user_id, 'hr.turni', true)) WITH CHECK (can_access(user_id, 'hr.turni', true));
CREATE POLICY "ss_d" ON public.staff_schedules FOR DELETE USING (can_access(user_id, 'hr.turni', true));

DROP POLICY IF EXISTS "own_personnel_costs" ON public.personnel_costs;
CREATE POLICY "pc_s" ON public.personnel_costs FOR SELECT USING (can_access(user_id, 'hr.turni', false));
CREATE POLICY "pc_i" ON public.personnel_costs FOR INSERT WITH CHECK (can_access(user_id, 'hr.turni', true));
CREATE POLICY "pc_u" ON public.personnel_costs FOR UPDATE USING (can_access(user_id, 'hr.turni', true)) WITH CHECK (can_access(user_id, 'hr.turni', true));
CREATE POLICY "pc_d" ON public.personnel_costs FOR DELETE USING (can_access(user_id, 'hr.turni', true));

-- ATTENDANCE: insert pubblico (PIN su /timbra), select mediata da employees
DROP POLICY IF EXISTS "owner_read_attendance" ON public.attendance;
CREATE POLICY "att_s" ON public.attendance FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = attendance.employee_id
      AND can_access(e.user_id, 'hr.presenze', false)
  )
);
CREATE POLICY "att_u" ON public.attendance FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = attendance.employee_id
      AND can_access(e.user_id, 'hr.presenze', true)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = attendance.employee_id
      AND can_access(e.user_id, 'hr.presenze', true)
  )
);
CREATE POLICY "att_d" ON public.attendance FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = attendance.employee_id
      AND can_access(e.user_id, 'hr.presenze', true)
  )
);

-- BUDGET
DROP POLICY IF EXISTS "own_budget_periods" ON public.budget_periods;
CREATE POLICY "bp_s" ON public.budget_periods FOR SELECT USING (can_access(user_id, 'conta.bud', false));
CREATE POLICY "bp_i" ON public.budget_periods FOR INSERT WITH CHECK (can_access(user_id, 'conta.bud', true));
CREATE POLICY "bp_u" ON public.budget_periods FOR UPDATE USING (can_access(user_id, 'conta.bud', true)) WITH CHECK (can_access(user_id, 'conta.bud', true));
CREATE POLICY "bp_d" ON public.budget_periods FOR DELETE USING (can_access(user_id, 'conta.bud', true));

DROP POLICY IF EXISTS "own_budget_scenarios" ON public.budget_scenarios;
CREATE POLICY "bs_s" ON public.budget_scenarios FOR SELECT USING (can_access(user_id, 'conta.bud', false));
CREATE POLICY "bs_i" ON public.budget_scenarios FOR INSERT WITH CHECK (can_access(user_id, 'conta.bud', true));
CREATE POLICY "bs_u" ON public.budget_scenarios FOR UPDATE USING (can_access(user_id, 'conta.bud', true)) WITH CHECK (can_access(user_id, 'conta.bud', true));
CREATE POLICY "bs_d" ON public.budget_scenarios FOR DELETE USING (can_access(user_id, 'conta.bud', true));

-- MARKETING / CRM
DROP POLICY IF EXISTS "own_tag_defs" ON public.tag_definitions;
CREATE POLICY "td_s" ON public.tag_definitions FOR SELECT USING (can_access(user_id, 'mkt.clienti', false));
CREATE POLICY "td_i" ON public.tag_definitions FOR INSERT WITH CHECK (can_access(user_id, 'mkt.clienti', true));
CREATE POLICY "td_u" ON public.tag_definitions FOR UPDATE USING (can_access(user_id, 'mkt.clienti', true)) WITH CHECK (can_access(user_id, 'mkt.clienti', true));
CREATE POLICY "td_d" ON public.tag_definitions FOR DELETE USING (can_access(user_id, 'mkt.clienti', true));

DROP POLICY IF EXISTS "own_customers" ON public.customers;
CREATE POLICY "cu_s" ON public.customers FOR SELECT USING (can_access(user_id, 'mkt.clienti', false));
CREATE POLICY "cu_i" ON public.customers FOR INSERT WITH CHECK (can_access(user_id, 'mkt.clienti', true));
CREATE POLICY "cu_u" ON public.customers FOR UPDATE USING (can_access(user_id, 'mkt.clienti', true)) WITH CHECK (can_access(user_id, 'mkt.clienti', true));
CREATE POLICY "cu_d" ON public.customers FOR DELETE USING (can_access(user_id, 'mkt.clienti', true));

DROP POLICY IF EXISTS "own_promotions" ON public.promotions;
CREATE POLICY "pro_s" ON public.promotions FOR SELECT USING (can_access(user_id, 'mkt.promo', false));
CREATE POLICY "pro_i" ON public.promotions FOR INSERT WITH CHECK (can_access(user_id, 'mkt.promo', true));
CREATE POLICY "pro_u" ON public.promotions FOR UPDATE USING (can_access(user_id, 'mkt.promo', true)) WITH CHECK (can_access(user_id, 'mkt.promo', true));
CREATE POLICY "pro_d" ON public.promotions FOR DELETE USING (can_access(user_id, 'mkt.promo', true));

DROP POLICY IF EXISTS "own_promotion_redemptions" ON public.promotion_redemptions;
CREATE POLICY "prr_s" ON public.promotion_redemptions FOR SELECT USING (can_access(user_id, 'mkt.promo', false));
CREATE POLICY "prr_i" ON public.promotion_redemptions FOR INSERT WITH CHECK (can_access(user_id, 'mkt.promo', true));
CREATE POLICY "prr_u" ON public.promotion_redemptions FOR UPDATE USING (can_access(user_id, 'mkt.promo', true)) WITH CHECK (can_access(user_id, 'mkt.promo', true));
CREATE POLICY "prr_d" ON public.promotion_redemptions FOR DELETE USING (can_access(user_id, 'mkt.promo', true));

DROP POLICY IF EXISTS "own_fid_programs" ON public.fidelity_programs;
CREATE POLICY "fp_s" ON public.fidelity_programs FOR SELECT USING (can_access(user_id, 'mkt.fidelity', false));
CREATE POLICY "fp_i" ON public.fidelity_programs FOR INSERT WITH CHECK (can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "fp_u" ON public.fidelity_programs FOR UPDATE USING (can_access(user_id, 'mkt.fidelity', true)) WITH CHECK (can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "fp_d" ON public.fidelity_programs FOR DELETE USING (can_access(user_id, 'mkt.fidelity', true));

DROP POLICY IF EXISTS "own_fid_rewards" ON public.fidelity_rewards;
CREATE POLICY "fr_s" ON public.fidelity_rewards FOR SELECT USING (can_access(user_id, 'mkt.fidelity', false));
CREATE POLICY "fr_i" ON public.fidelity_rewards FOR INSERT WITH CHECK (can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "fr_u" ON public.fidelity_rewards FOR UPDATE USING (can_access(user_id, 'mkt.fidelity', true)) WITH CHECK (can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "fr_d" ON public.fidelity_rewards FOR DELETE USING (can_access(user_id, 'mkt.fidelity', true));

DROP POLICY IF EXISTS "own_fid_movements" ON public.fidelity_movements;
CREATE POLICY "fm_s" ON public.fidelity_movements FOR SELECT USING (can_access(user_id, 'mkt.fidelity', false));
CREATE POLICY "fm_i" ON public.fidelity_movements FOR INSERT WITH CHECK (can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "fm_u" ON public.fidelity_movements FOR UPDATE USING (can_access(user_id, 'mkt.fidelity', true)) WITH CHECK (can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "fm_d" ON public.fidelity_movements FOR DELETE USING (can_access(user_id, 'mkt.fidelity', true));

-- (Tabelle non listate sopra: lasciate invariate. Aggiungere via patch successive
-- se servono allo staff. Esempio: automations, campaigns, reservations, surveys, reviews, centralino_*.)

COMMIT;

-- ============================================================
-- FINE migration. Verifica:
--   SELECT * FROM employees LIMIT 1;            -- vede module_permissions, auth_user_id
--   SELECT public.can_access('00000000-0000-0000-0000-000000000000'::uuid, 'mag.ricette');
-- ============================================================
