-- ============================================================
-- HACCP — Documenti aziendali (fase 1)
-- ============================================================
-- Archivio centralizzato dei documenti HACCP / sicurezza / autorizzazioni
-- aziendali con tracking scadenze. Le fasi successive aggiungeranno:
--   - employee_certificates (corsi/attestati per dipendente)
--   - haccp_log_templates / _entries (registri autocontrollo)
--   - haccp_qr_tokens (QR ispettori NAS / ASL / Ispettorato)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.haccp_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  locale text,                          -- null = generale per tutta l'azienda
  categoria text NOT NULL,              -- 'dvr','scia_commerciale','scia_sanitaria','manuale_haccp','organigramma',
                                        -- 'manutenzione_estintori','manutenzione_cappe','manutenzione_impianti',
                                        -- 'potabilita','disinfestazione','autorizzazioni','contratti_servizi','altro'
  titolo text NOT NULL,                 -- es. "DVR 2026 - aggiornato"
  file_path text,                       -- path nel bucket 'documents' (haccp/{user_id}/{uuid}.{ext})
  data_emissione date,
  scadenza date,                        -- null = non scade
  responsabile text,                    -- es. "RSPP Mario Rossi"
  fornitore text,                       -- es. "GielleService srl" per manutenzioni
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS haccp_documents_user_idx ON public.haccp_documents(user_id);
CREATE INDEX IF NOT EXISTS haccp_documents_user_scadenza_idx ON public.haccp_documents(user_id, scadenza);
CREATE INDEX IF NOT EXISTS haccp_documents_user_categoria_idx ON public.haccp_documents(user_id, categoria);

ALTER TABLE public.haccp_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haccp_doc_s" ON public.haccp_documents;
DROP POLICY IF EXISTS "haccp_doc_i" ON public.haccp_documents;
DROP POLICY IF EXISTS "haccp_doc_u" ON public.haccp_documents;
DROP POLICY IF EXISTS "haccp_doc_d" ON public.haccp_documents;

CREATE POLICY "haccp_doc_s" ON public.haccp_documents FOR SELECT USING (
  public.can_access(user_id, 'haccp.documenti', false)
);
CREATE POLICY "haccp_doc_i" ON public.haccp_documents FOR INSERT WITH CHECK (
  public.can_access(user_id, 'haccp.documenti', true)
);
CREATE POLICY "haccp_doc_u" ON public.haccp_documents FOR UPDATE USING (
  public.can_access(user_id, 'haccp.documenti', true)
) WITH CHECK (public.can_access(user_id, 'haccp.documenti', true));
CREATE POLICY "haccp_doc_d" ON public.haccp_documents FOR DELETE USING (
  public.can_access(user_id, 'haccp.documenti', true)
);

-- Aggiunge 'haccp' ai tabs di tutti i feature_plans esistenti che non lo hanno
-- (cosi' il modulo top-level appare a tutti gli owner)
UPDATE public.feature_plans
SET features = jsonb_set(
  features,
  '{tabs}',
  COALESCE(features->'tabs', '[]'::jsonb) || '["haccp"]'::jsonb
)
WHERE NOT (features->'tabs' @> '["haccp"]'::jsonb);

COMMIT;
