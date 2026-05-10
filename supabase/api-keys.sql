-- ============================================================
-- API Keys: integrazione POS / sviluppatori esterni / sistemi terzi
-- ============================================================
-- Permette al POS (e ad altri client) di leggere/scrivere clienti CRM,
-- vendite/scontrini, programmi fedelta', promozioni — usando una chiave
-- API invece dell'auth utente.
--
-- Sicurezza:
--   - la chiave completa viene mostrata SOLO al momento della generazione
--   - in DB salviamo solo l'hash sha256 (key_hash) + i primi 8 char per UI
--   - revoca = soft delete (revoked_at non null)
--   - last_used_at aggiornato ad ogni richiesta autorizzata
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,                     -- descrittivo: "POS REMEMBEER", "Filippo dev"
  tipo text NOT NULL DEFAULT 'pos',       -- 'pos' | 'dev' | 'integration'
  locale text,                            -- null = chiave globale per tutti i locali
  key_prefix text NOT NULL,               -- primi 12 char visibili "pk_live_..." per UI
  key_hash text NOT NULL UNIQUE,          -- sha256 della chiave completa
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- es. ["customers.read","customers.write","sales.write","loyalty.read",
    --      "loyalty.write","promotions.read"]
  last_used_at timestamptz,
  last_used_ip text,
  uses_count int NOT NULL DEFAULT 0,
  revoked_at timestamptz,                 -- soft delete
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx       ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx       ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_user_active_idx ON public.api_keys(user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_s" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_i" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_u" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_d" ON public.api_keys;

-- Solo owner (auth.uid) o staff con permesso 'imp.api_keys' puo' vedere/gestire
CREATE POLICY "api_keys_s" ON public.api_keys FOR SELECT USING (
  user_id = auth.uid() OR public.can_access(user_id, 'imp.api_keys', false)
);
CREATE POLICY "api_keys_i" ON public.api_keys FOR INSERT WITH CHECK (
  user_id = auth.uid() OR public.can_access(user_id, 'imp.api_keys', true)
);
CREATE POLICY "api_keys_u" ON public.api_keys FOR UPDATE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'imp.api_keys', true)
) WITH CHECK (user_id = auth.uid() OR public.can_access(user_id, 'imp.api_keys', true));
CREATE POLICY "api_keys_d" ON public.api_keys FOR DELETE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'imp.api_keys', true)
);

-- ============================================================
-- loyalty_transactions: storico movimenti punti programma fedelta'
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  customer_id uuid NOT NULL,              -- FK logica a customers.id
  punti_delta int NOT NULL,                -- positivo = guadagno, negativo = redemption
  descrizione text,
  riferimento_tipo text,                  -- 'pos','manual','promotion','redemption'
  riferimento_id text,                    -- es. id scontrino POS
  locale text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loyalty_tx_user_idx     ON public.loyalty_transactions(user_id);
CREATE INDEX IF NOT EXISTS loyalty_tx_customer_idx ON public.loyalty_transactions(customer_id, created_at DESC);

ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_tx_s" ON public.loyalty_transactions;
DROP POLICY IF EXISTS "loyalty_tx_i" ON public.loyalty_transactions;
DROP POLICY IF EXISTS "loyalty_tx_u" ON public.loyalty_transactions;
DROP POLICY IF EXISTS "loyalty_tx_d" ON public.loyalty_transactions;

CREATE POLICY "loyalty_tx_s" ON public.loyalty_transactions FOR SELECT USING (
  user_id = auth.uid() OR public.can_access(user_id, 'mkt.fidelity', false)
);
CREATE POLICY "loyalty_tx_i" ON public.loyalty_transactions FOR INSERT WITH CHECK (
  user_id = auth.uid() OR public.can_access(user_id, 'mkt.fidelity', true)
);
CREATE POLICY "loyalty_tx_u" ON public.loyalty_transactions FOR UPDATE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'mkt.fidelity', true)
) WITH CHECK (user_id = auth.uid() OR public.can_access(user_id, 'mkt.fidelity', true));
CREATE POLICY "loyalty_tx_d" ON public.loyalty_transactions FOR DELETE USING (
  user_id = auth.uid() OR public.can_access(user_id, 'mkt.fidelity', true)
);

COMMIT;
