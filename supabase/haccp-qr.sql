-- ============================================================
-- HACCP — QR ispezioni (fase 5)
-- ============================================================
-- Token configurabili per ispettori esterni.
-- L'owner crea token con scope personalizzato + scadenza (1g / 7g / 30g).
-- L'ispettore apre /haccp/qr/{token} e vede SOLO i dati abilitati
-- (no login, no permessi sensibili tipo paghe/CCNL ecc. a meno di
-- esplicita inclusione nello scope).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.haccp_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL UNIQUE,           -- random ~32 chars, usato in URL pubblico
  nome text NOT NULL,                   -- es. "Visita NAS gennaio 2026"
  destinatario text,                    -- es. "ASL TO3 / Dr. Rossi"

  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- struttura scope:
    -- {
    --   "documenti_categorie": ["dvr","manuale_haccp","manutenzione_estintori",...],
    --   "documenti_locali": ["REMEMBEER","CASA DE AMICIS"],   // null/missing = tutti
    --   "lotti_periodo_giorni": 90,                            // ultimi N giorni; null = no lotti
    --   "lotti_locali": null,                                   // null = tutti
    --   "registri_template_ids": ["uuid1","uuid2"],            // null = tutti
    --   "registri_periodo_giorni": 30,
    --   "attestati_tipi": ["haccp_alimentarista","antincendio_basso",...],
    --   "attestati_includi_employees": true,                   // mostra anche nomi dipendenti
    --   "mostra_anomalie": true,                                // se false nasconde anomalie nei registri
    --   "mostra_dati_dipendenti": false                         // se true mostra nomi/ruoli; mai contratti/paghe
    -- }

  scadenza_at timestamptz NOT NULL,
  ultimo_accesso_at timestamptz,
  accessi_count int NOT NULL DEFAULT 0,
  attivo boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS haccp_qr_tokens_user_idx ON public.haccp_qr_tokens(user_id);
CREATE INDEX IF NOT EXISTS haccp_qr_tokens_token_idx ON public.haccp_qr_tokens(token);

ALTER TABLE public.haccp_qr_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haccp_qr_s" ON public.haccp_qr_tokens;
DROP POLICY IF EXISTS "haccp_qr_i" ON public.haccp_qr_tokens;
DROP POLICY IF EXISTS "haccp_qr_u" ON public.haccp_qr_tokens;
DROP POLICY IF EXISTS "haccp_qr_d" ON public.haccp_qr_tokens;

CREATE POLICY "haccp_qr_s" ON public.haccp_qr_tokens FOR SELECT USING (
  public.can_access(user_id, 'haccp.ispezioni', false)
);
CREATE POLICY "haccp_qr_i" ON public.haccp_qr_tokens FOR INSERT WITH CHECK (
  public.can_access(user_id, 'haccp.ispezioni', true)
);
CREATE POLICY "haccp_qr_u" ON public.haccp_qr_tokens FOR UPDATE USING (
  public.can_access(user_id, 'haccp.ispezioni', true)
) WITH CHECK (public.can_access(user_id, 'haccp.ispezioni', true));
CREATE POLICY "haccp_qr_d" ON public.haccp_qr_tokens FOR DELETE USING (
  public.can_access(user_id, 'haccp.ispezioni', true)
);

COMMIT;
