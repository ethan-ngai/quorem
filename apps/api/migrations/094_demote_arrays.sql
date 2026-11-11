ALTER TABLE public.foundational_topics
  ADD COLUMN is_foundational boolean NOT NULL DEFAULT true;

UPDATE public.foundational_topics SET is_foundational = false WHERE slug = 'arrays';
