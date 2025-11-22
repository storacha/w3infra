# Stripe Dedupe Customers

Our current Stripe and database contain duplicated users, mainly because we did not previously check if a user with the same email already had an active subscription.

## What this tool does

This tool analyzes duplicate Stripe customers (same email), performs safe automated cleanup for zero‑footprint duplicates, and produces a CSV containing only the cases that require manual review.

- **Input:** CSV exported from Stripe Sigma listing emails that have more than one customer id
- **Automated actions (when safe):** delete redundant customer records that meet strict safety rules (see below)
- **Output:** `manual-review.csv` with only the duplicate cases that are unsafe to auto-resolve

Columns:

- `email`
- `canonical_customer_id` (the customer we keep per our rules)
- `other_customer_id`
- `reason` (why this case needs manual attention)
- `active_subscriptions` (count on the other customer)
- `lifetime_paid_total` (cents)
- `open_or_draft_amount_due` (total cents due on open/draft invoices)
- `balance` (cents)
- `default_payment_method` (id or empty)
- `created` (ISO)

Cases that are auto-resolved internally (and therefore NOT included in this CSV):

- No paid invoices, no open/draft invoices with non-zero amount due, zero balance, and never paid ("zero-footprint" duplicates) → the extra customers are deleted
- Duplicates with only free/trialing subscriptions and no financial footprint are deleted

Everything else lands in `manual-review.csv` with a human-friendly reason.

## Dedupe process and decision rules

Canonical customer selection per email:

1. If present and valid: the Stripe ID stored in our Dynamo customers table
2. Else: the customer with highest lifetime paid total
3. If all totals are zero: the newest customer that has a payment method, otherwise newest created

Reasons a case will be flagged for manual review:

- Another customer for the same email has paid invoices
- Open/draft invoices with non-zero amount due exist on a non-canonical customer
- Non-zero customer balance (credits/debits) on a non-canonical customer
- Conflicting source of truth (Dynamo points to a different Stripe ID than heuristics)

### Mutations performed (automated)

When a non-canonical customer meets all safety conditions, the script will:

- Delete the redundant customer record in Stripe

## Source list: Stripe Sigma duplicate emails

Generate the base list of duplicate emails via Stripe Sigma, then export as CSV:

1. Open the saved [query](https://dashboard.stripe.com/sigma/queries/qfl_1SUoLhF6A5ufQX5vXbmEy2cZ)
2. Run and export the results as CSV and pass its path to the script.

## Safety notes

- This tool can delete redundant customers in Stripe when the strict safety rules are met. Test with a test API key first.
- Automation (deleting customers) should be guarded by:
  - Dry-run mode
  - Zero-footprint checks (no paid invoices, no open/draft invoices with amount due, no balance)

## How to run

Run the script (from repository root):

```bash
cd billing/scripts/stripe-dedupe-customers
node index.js path/to/duplicated-customers-report.csv [--apply] [--resume] [--start=<n>] [--checkpoint=<file>]
```

### Arguments

- `<csv>`: Path to the Stripe Sigma duplicate customers CSV file (required)
- `--apply`: Actually perform deletions in Stripe. If omitted, runs in dry-run mode (no deletions, just logs and outputs CSV)
- `--resume`: Resume from a previous checkpoint file, skipping already processed emails
- `--start=<n>`: Start processing from group index `<n>` (useful for partial runs or debugging)
- `--checkpoint=<file>`: Specify a custom checkpoint file to track processed emails (default: `dedupe-checkpoint.txt`)

**Example:**

```bash
node index.js duplicate_users_report.csv --apply --resume --start=100 --checkpoint=my-checkpoint.txt
```