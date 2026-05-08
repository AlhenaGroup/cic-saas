-- ============================================================
-- HACCP — Corsi & Attestati per dipendente (fase 2)
-- ============================================================
-- Per ogni dipendente: HACCP, antincendio, primo soccorso, RSPP, RLS,
-- HACCP responsabile, ecc. Caricamento attestato + scadenza.
-- I dipendenti vedono i propri attestati su /timbra → "I miei attestati".
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  tipo text NOT NULL,                   -- 'haccp_alimentarista','haccp_responsabile','antincendio_basso',
                                        -- 'antincendio_medio','antincendio_alto','primo_soccorso',
                                        -- 'rspp','rls','sicurezza_generale','sicurezza_specifica','altro'
  titolo text NOT NULL,                 -- es. "Corso HACCP alimentarista 12h"
  file_path text,                       -- path nel bucket 'documents' (haccp-corsi/{user_id}/{uuid}.{ext})
  data_emissione date,
  scadenza date,                        -- null = non scade
  durata_ore int,                       -- ore corso
  ente_erogante text,                   -- es. "Confcommercio Pinerolo"
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_certificates_user_idx ON public.employee_certificates(user_id);
CREATE INDEX IF NOT EXISTS employee_certificates_employee_idx ON public.employee_certificates(employee_id);
CREATE INDEX IF NOT EXISTS employee_certificates_user_scadenza_idx ON public.employee_certificates(user_id, scadenza);

ALTER TABLE public.employee_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haccp_cert_s" ON public.employee_certificates;
DROP POLICY IF EXISTS "haccp_cert_i" ON public.employee_certificates;
DROP POLICY IF EXISTS "haccp_cert_u" ON public.employee_certificates;
DROP POLICY IF EXISTS "haccp_cert_d" ON public.employee_certificates;

CREATE POLICY "haccp_cert_s" ON public.employee_certificates FOR SELECT USING (
  public.can_access(user_id, 'haccp.corsi', false)
);
CREATE POLICY "haccp_cert_i" ON public.employee_certificates FOR INSERT WITH CHECK (
  public.can_access(user_id, 'haccp.corsi', true)
);
CREATE POLICY "haccp_cert_u" ON public.employee_certificates FOR UPDATE USING (
  public.can_access(user_id, 'haccp.corsi', true)
) WITH CHECK (public.can_access(user_id, 'haccp.corsi', true));
CREATE POLICY "haccp_cert_d" ON public.employee_certificates FOR DELETE USING (
  public.can_access(user_id, 'haccp.corsi', true)
);

COMMIT;
