-- ============================================================
-- HACCP — Registri autocontrollo (fase 4)
-- ============================================================
-- Template configurabili dall'owner (es. temperatura frigo, pulizia banco)
-- Entries compilabili da owner (dashboard) e staff (PIN /timbra).
-- ============================================================

BEGIN;

-- Template: definizione campi del registro + frequenza + locale
CREATE TABLE IF NOT EXISTS public.haccp_log_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,                   -- es. "Temperatura frigo banco"
  descrizione text,
  locale text,                          -- null = tutti i locali
  frequenza text NOT NULL DEFAULT 'giornaliera', -- 'giornaliera','settimanale','mensile','on_event'
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Esempio fields:
    -- [
    --   { "key":"temp_frigo_1", "label":"Temp frigo 1 (°C)", "type":"number", "min":0, "max":4, "required":true },
    --   { "key":"sanificato",   "label":"Sanificato",         "type":"boolean", "required":true },
    --   { "key":"note",         "label":"Note",               "type":"text",    "required":false }
    -- ]
  attivo boolean NOT NULL DEFAULT true,
  ordine int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS haccp_log_tpl_user_idx ON public.haccp_log_templates(user_id);
CREATE INDEX IF NOT EXISTS haccp_log_tpl_user_attivo_idx ON public.haccp_log_templates(user_id, attivo);

ALTER TABLE public.haccp_log_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haccp_tpl_s" ON public.haccp_log_templates;
DROP POLICY IF EXISTS "haccp_tpl_i" ON public.haccp_log_templates;
DROP POLICY IF EXISTS "haccp_tpl_u" ON public.haccp_log_templates;
DROP POLICY IF EXISTS "haccp_tpl_d" ON public.haccp_log_templates;

CREATE POLICY "haccp_tpl_s" ON public.haccp_log_templates FOR SELECT USING (
  public.can_access(user_id, 'haccp.registri', false)
);
CREATE POLICY "haccp_tpl_i" ON public.haccp_log_templates FOR INSERT WITH CHECK (
  public.can_access(user_id, 'haccp.registri', true)
);
CREATE POLICY "haccp_tpl_u" ON public.haccp_log_templates FOR UPDATE USING (
  public.can_access(user_id, 'haccp.registri', true)
) WITH CHECK (public.can_access(user_id, 'haccp.registri', true));
CREATE POLICY "haccp_tpl_d" ON public.haccp_log_templates FOR DELETE USING (
  public.can_access(user_id, 'haccp.registri', true)
);

-- Entries: compilazioni del template
CREATE TABLE IF NOT EXISTS public.haccp_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.haccp_log_templates(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  operatore_nome text,                  -- snapshot del nome operatore al momento della compilazione
  locale text,                          -- snapshot locale (default = template.locale)
  data_compilazione date NOT NULL DEFAULT CURRENT_DATE,
  ora_compilazione time NOT NULL DEFAULT CURRENT_TIME,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Esempio values:
    -- { "temp_frigo_1": 2.5, "sanificato": true, "note": "tutto ok" }
  anomalia boolean NOT NULL DEFAULT false,  -- true se almeno un valore numerico fuori range min/max
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS haccp_log_entries_user_idx ON public.haccp_log_entries(user_id);
CREATE INDEX IF NOT EXISTS haccp_log_entries_template_idx ON public.haccp_log_entries(template_id);
CREATE INDEX IF NOT EXISTS haccp_log_entries_user_data_idx ON public.haccp_log_entries(user_id, data_compilazione DESC);

ALTER TABLE public.haccp_log_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haccp_ent_s" ON public.haccp_log_entries;
DROP POLICY IF EXISTS "haccp_ent_i" ON public.haccp_log_entries;
DROP POLICY IF EXISTS "haccp_ent_u" ON public.haccp_log_entries;
DROP POLICY IF EXISTS "haccp_ent_d" ON public.haccp_log_entries;

CREATE POLICY "haccp_ent_s" ON public.haccp_log_entries FOR SELECT USING (
  public.can_access(user_id, 'haccp.registri', false)
);
CREATE POLICY "haccp_ent_i" ON public.haccp_log_entries FOR INSERT WITH CHECK (
  public.can_access(user_id, 'haccp.registri', true)
);
CREATE POLICY "haccp_ent_u" ON public.haccp_log_entries FOR UPDATE USING (
  public.can_access(user_id, 'haccp.registri', true)
) WITH CHECK (public.can_access(user_id, 'haccp.registri', true));
CREATE POLICY "haccp_ent_d" ON public.haccp_log_entries FOR DELETE USING (
  public.can_access(user_id, 'haccp.registri', true)
);

COMMIT;
