# Grant a Free Month on Draft Invoices

## Context

Grants a free month to subscribers by adding a credit that offsets the base fee line item on their draft invoice. Must be run before the invoice finalizes.

## Description

Reads invoice IDs from a CSV file, validates each invoice is still in draft status, finds the base fee line item matching the target price IDs and period, and adds a credit invoice item of the same value to zero it out.

> **Note:** The invoice period and line item period dates are hardcoded in `index.js` (`EXPECTED_PERIOD_START_DATE`, `EXPECTED_PERIOD_END_DATE`). Update them if re-running for a different month.

## Target Price IDs

- `price_1SUtvLF6A5ufQX5vjHMdUcHh` (Extra Spicy Tier)
- `price_1SUtvAF6A5ufQX5vM1Dc3Kpl` (Medium Tier)

## Generating the Input CSV

Run the following query in [Stripe Sigma](https://dashboard.stripe.com/sigma/queries):

```sql
SELECT DISTINCT
  i.id AS invoice_id
FROM
  invoices i
  JOIN invoice_line_items ili ON i.id = ili.invoice_id
WHERE
  i.status = 'draft'
  AND ili.price_id IN ('price_XXX', 'price_YYY')
  AND i.period_start = from_unixtime(1772323200)
  AND i.period_end = from_unixtime(1775001600)
ORDER BY
  i.id
```

Export the result as CSV — it must have an `invoice_id` column.

## How to Use

```bash
# Requires .env.local with:
# STRIPE_API_KEY=sk_live_...
# STORACHA_ENV=prod

node billing/scripts/update-invoice-draft-with-discount/index.js invoices-from-march-2026.csv
```

## Output Files

- `remove-lines-report.csv` — per-invoice summary: customer ID, plan name, price ID, total before, discount amount, total after
- `remove-lines-errors.csv` — any errors encountered during processing
