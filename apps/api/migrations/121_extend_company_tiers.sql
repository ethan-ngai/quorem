INSERT INTO public.company_tiers(company_key, tier)
VALUES
  ('openai', 'top'),
  ('coinbase', 'top'),
  ('duolingo', 'top'),
  ('crowdstrike', 'mid-tier'),
  ('sig', 'quant'),
  ('jump trading', 'quant'),
  ('drw', 'quant')
ON CONFLICT (company_key) DO UPDATE SET tier = EXCLUDED.tier;
