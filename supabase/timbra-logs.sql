-- ============================================================
-- Logging /timbra: cattura tentativi falliti / abbandonati
-- ============================================================
-- Scopo: capire cosa succede quando un dipendente dice "ho timbrato"
-- ma nel DB non c'e' niente. Cattura:
--   - errori di rete (offline, fetch failed)
--   - errori server (4xx/5xx con messaggio)
--   - errori GPS (denied, timeout)
--   - abbandono pagina mid-flow (visibilitychange + chiusura app)
--   - eventi PIN sbagliato / locale fuori range
--
-- Niente RLS sul write: l'endpoint pubblico lo gestisce con service-role.
-- Lettura: solo owner (RLS).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.timbra_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,                          -- owner del locale (se ricavabile dal PIN)
  employee_id uuid,                      -- se PIN match
  employee_name text,                    -- snapshot
  pin_last4 text,                        -- ultime 4 cifre PIN tentato (debug, no PII completa)
  locale text,                           -- locale dichiarato dal client
  action text NOT NULL,                  -- 'checklist-submit','timbra','checklist-response','abandon',...
  step text,                             -- 'pin','checklist','gps-wait','submitting',...
  level text NOT NULL DEFAULT 'error',   -- 'error','warning','info'
  message text NOT NULL,                 -- descrizione
  error_type text,                       -- 'network','gps','server-4xx','server-5xx','client','abandon'
  http_status int,                       -- se HTTP
  user_agent text,                       -- snapshot User-Agent
  online boolean,                        -- navigator.onLine al momento
  gps_status text,                       -- 'ok','denied','unavailable','timeout','none'
  payload jsonb,                         -- contesto (no PII sensibili)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timbra_logs_user_idx ON public.timbra_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS timbra_logs_employee_idx ON public.timbra_logs(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS timbra_logs_locale_idx ON public.timbra_logs(locale, created_at DESC);

ALTER TABLE public.timbra_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timbra_logs_s" ON public.timbra_logs;
DROP POLICY IF EXISTS "timbra_logs_d" ON public.timbra_logs;
-- Insert: solo via endpoint /api/timbra-log (service-role bypassa RLS).
-- Niente policy INSERT pubblica: gli anonymous client non scrivono direttamente.

CREATE POLICY "timbra_logs_s" ON public.timbra_logs FOR SELECT USING (
  user_id = auth.uid() OR public.can_access(user_id, 'imp.log_timbra', false)
);
CREATE POLICY "timbra_logs_d" ON public.timbra_logs FOR DELETE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'imp.log_timbra', true)
);

COMMIT;
