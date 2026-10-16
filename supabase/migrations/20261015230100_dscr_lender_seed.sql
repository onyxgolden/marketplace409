-- Seed DSCR lender listings (v1 directory bootstrap).
-- Public info only. Each row records its public source as a receipt.
-- All seeded terms are provider-published on the lender's own site;
-- marked provider-claimed per DSCR-SCOPE-002/004.

INSERT INTO public.dscr_lenders (
  company_name, nmls_number, nmls_consumer_access_url,
  identity_review_status, status,
  states_served, min_loan_amount, max_loan_amount,
  property_types, transaction_types,
  occupancy_entity_restrictions, max_ltv, min_dscr_accepted,
  contact_phone, contact_email, application_url,
  terms_as_of_date, last_directory_reviewed_at, last_provider_confirmed_at,
  public_source_url, public_source_retrieved_at,
  seed_receipt
) VALUES
-- 1. Visio Lending (Visio Financial Services Inc.)
(
  'Visio Lending', '1935590',
  'https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/1935590',
  'identity-confirmed', 'published',
  ARRAY['TX','CA','AZ','FL','GA','NC','SC','TN','CO','NV','WA','OR','OH','PA','VA','MD','NJ','NY','IL','MI','MN','WI','MO','KS','OK','AR','LA','MS','AL','KY','IN','IA','NE','UT','ID','MT','NM','NH','ME','VT','MA','CT','RI','DE','DC'],
  100000, 5000000,
  ARRAY['SFR','2-4 unit','5+ unit'],
  ARRAY['purchase','rate-term refinance','cash-out refinance'],
  'Investment-only; LLC borrowers allowed',
  80, 1.00,
  '888.521.0353', NULL, 'https://visiolending.com/',
  '2026-10-15', '2026-10-15', '2026-10-15',
  'https://visiolending.com/', '2026-10-15',
  'Seed v1: company name, NMLS 1935590, phone 888.521.0353, Austin TX address from visiolending.com footer (retrieved 2026-10-15). Terms marked provider-claimed.'
),
-- 2. Lima One Capital, LLC
(
  'Lima One Capital', '1324403',
  'https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/1324403',
  'identity-confirmed', 'published',
  ARRAY['AL','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','OH','OK','OR','PA','RI','SC','TN','TX','UT','VA','WA','WV','WI','WY'],
  75000, 10000000,
  ARRAY['SFR','2-4 unit','5+ unit'],
  ARRAY['purchase','rate-term refinance','cash-out refinance'],
  'Investment-only',
  80, 1.00,
  '800.390.4212', 'hello@limaone.com', 'https://www.limaone.com/',
  '2026-10-15', '2026-10-15', '2026-10-15',
  'https://www.limaone.com/rental-dscr-loans-texas/', '2026-10-15',
  'Seed v1: company name, NMLS 1324403, phone 800.390.4212, email hello@limaone.com from limaone.com footer (retrieved 2026-10-15). Does not lend in AK, ND, SD, VT per site. Terms marked provider-claimed.'
),
-- 3. CoreVest American Finance Lender LLC (dba CoreVest Finance)
(
  'CoreVest Finance', '1627183',
  'https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/1627183',
  'identity-confirmed', 'published',
  ARRAY['CA','TX','FL','NY','NJ','AZ','CO','WA','OR','NV','UT','GA','NC','SC','TN','VA','MD','PA','OH','IL','MI','MN','WI','MO','KS','OK','AR','LA','MS','AL','KY','IN','IA','NE','NM','ID','MT','WY','ND','SD','NE','ME','NH','VT','MA','CT','RI','DE','DC','HI'],
  75000, 2000000,
  ARRAY['SFR','2-4 unit'],
  ARRAY['purchase','rate-term refinance','cash-out refinance'],
  'Investment-only; commercial business-purpose loans',
  80, 1.00,
  '844.223.7496', 'info@corevestfinance.com', 'https://www.corevestfinance.com/',
  '2026-10-15', '2026-10-15', '2026-10-15',
  'https://www.corevestfinance.com/markets/new-york-dscr-loans', '2026-10-15',
  'Seed v1: company name, NMLS 1627183, phone 844.223.7496 from corevestfinance.com (retrieved 2026-10-15). 30-year DSCR, SFR 1-4 unit, $75k-$2M+, up to 80% LTV per site. Subsidiary of Redwood Trust. Terms marked provider-claimed.'
);
