INSERT INTO public.company_tiers(company_key, tier)
VALUES ('cloudflare', 'top')
ON CONFLICT (company_key) DO UPDATE SET tier = EXCLUDED.tier;
