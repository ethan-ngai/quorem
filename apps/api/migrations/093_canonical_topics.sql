INSERT INTO public.foundational_topics(slug, label, aliases) VALUES
  ('arrays', 'Arrays', '{array}'),
  ('binary-trees', 'Binary Trees', '{binary-tree}'),
  ('hash-tables', 'Hash Tables', '{hash-table,hash-map,hash-maps,hashtable,hashmap}'),
  ('graphs', 'Graphs', '{graph}');

UPDATE public.foundational_topics SET aliases = ARRAY['sort'] WHERE slug = 'sorting';
