-- Key by normalized name so imports pick up tiers even on a fresh database.
CREATE TABLE public.company_tiers (
  company_key text PRIMARY KEY,
  tier text NOT NULL CHECK (tier IN ('faang', 'top', 'quant', 'mid-tier'))
);

INSERT INTO public.company_tiers(company_key, tier)
SELECT lower(name), tier
FROM (VALUES
  ('faang', ARRAY['Amazon', 'Apple', 'Google', 'Meta', 'Netflix']),
  ('top', ARRAY[
    'Adobe', 'Airbnb', 'AMD', 'Anduril', 'Atlassian', 'Bloomberg', 'ByteDance', 'Capital One',
    'Databricks', 'Datadog', 'DoorDash', 'Goldman Sachs', 'LinkedIn', 'Lyft', 'Microsoft',
    'Nvidia', 'PayPal', 'Pinterest', 'Robinhood', 'Roblox', 'Salesforce', 'Snowflake', 'Spotify',
    'Stripe', 'Tesla', 'TikTok', 'Uber', 'Visa', 'Waymo', 'Zoox'
  ]),
  ('quant', ARRAY[
    'Akuna Capital', 'AQR Capital Management', 'Citadel', 'DE Shaw', 'GSA Capital',
    'Hudson River Trading', 'IMC', 'Jane Street', 'Millennium', 'Optiver', 'Point72',
    'Squarepoint Capital', 'Tower Research Capital', 'Two Sigma', 'Virtu Financial', 'WorldQuant'
  ]),
  ('mid-tier', ARRAY[
    'Alibaba', 'American Express', 'Arista Networks', 'Asana', 'Autodesk', 'Barclays', 'Box',
    'Cisco', 'Citigroup', 'Dell', 'Deloitte', 'Deutsche Bank', 'Disney', 'Dropbox', 'eBay',
    'Epic Systems', 'Expedia', 'General Motors', 'Grammarly', 'Honeywell', 'HP', 'Hulu', 'IBM',
    'Indeed', 'Intel', 'Intuit', 'Mastercard', 'McKinsey', 'Morgan Stanley', 'Okta', 'Oracle',
    'Palo Alto Networks', 'Qualcomm', 'Riot Games', 'Rippling', 'Roku', 'Samsung', 'SAP',
    'ServiceNow', 'Snap', 'SoFi', 'Sony', 'Tencent', 'Unity', 'Walmart Labs', 'Wayfair',
    'Wells Fargo', 'Whatnot', 'Workday', 'X', 'Yahoo'
  ])
) AS tiers(tier, names)
CROSS JOIN LATERAL unnest(names) AS company(name);
