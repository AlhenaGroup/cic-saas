-- ============================================================
-- Gerarchia dipendenti + tipo task
-- ============================================================
-- 1) employees.manager_id : albero N-livelli (Amministrazione → Manager → Dipendente)
-- 2) tasks.tipo / task_templates.tipo : 'compito' | 'problema' | 'scadenza' (default 'compito')
-- ============================================================

BEGIN;

-- 1) Manager diretto sul dipendente (FK self-reference)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employees_manager_id_idx ON public.employees(manager_id);

-- 2) Tipo task (compito / problema / scadenza)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'compito';

ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'compito';

ALTER TABLE public.task_knowledge
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'compito';

-- 2b) Delegabilita': se false, il manager con task_dispatch non puo' riassegnarla
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS is_delegable boolean NOT NULL DEFAULT true;

ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS is_delegable boolean NOT NULL DEFAULT true;

-- Constraint: valore tra i 3 ammessi
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_tipo_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_tipo_check CHECK (tipo IN ('compito','problema','scadenza'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_templates_tipo_check') THEN
    ALTER TABLE public.task_templates ADD CONSTRAINT task_templates_tipo_check CHECK (tipo IN ('compito','problema','scadenza'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_knowledge_tipo_check') THEN
    ALTER TABLE public.task_knowledge ADD CONSTRAINT task_knowledge_tipo_check CHECK (tipo IN ('compito','problema','scadenza'));
  END IF;
END $$;

COMMIT;

-- Verifica:
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='employees' AND column_name='manager_id';
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tasks' AND column_name='tipo';
