# Egress Helpers

This folder contains scripts to help with egress-related tasks.

* `1-read-events-and-aggregate.js`
* `2-write-aggregates-to-monthly-table.js`
* `3-get-customer-egress-from-monthly-table.js`

## Context

* The `egress-traffic-events` table is the source of truth for raw egress events.
* The `egress-traffic-monthly` table stores pre-aggregated egress data for fast “egress this month” queries.

## Prerequisites

- AWS credentials configured
- `.env.local` file with required environment variables:
  - `STORACHA_ENV`
  - `AWS_REGION`

## Usage

### 1: Read Events From Traffic Table And Generate Aggregate Info

Generate aggregates file from raw events:

```bash
cd billing/scripts/backfill-egress-monthly
node 1-read-events-and-aggregate.js from=2024-01-01 to=2026-03-01
```

**Output:** `egress-monthly-aggregates-2024-01-01-2026-03-01.json`

Supports the optional parameter `customer`:

```bash
cd billing/scripts/backfill-egress-monthly
node 1-read-events-and-aggregate.js from=2024-01-01 to=2026-03-01 customer=did:mailto:example.com:alice
```

**Output:** `egress-monthly-aggregates-2024-01-01-2026-03-01-did:mailto:example.com:alice.json`

This script is READ-ONLY and safe to re-run multiple times.

### 2: Write Aggregates

Write aggregates to monthly table:

```bash
node 2-write-aggregates-to-monthly-table.js input=egress-monthly-aggregates-2024-01-01-2026-03-01.json
```

**If interrupted, resume from where it left off:**

```bash
node 2-write-aggregates-to-monthly-table.js input=egress-monthly-aggregates-2024-01-01-2026-03-01.json --resume
```

**⚠️ WARNING: NOT idempotent!**

This script uses DynamoDB ADD operation (increment) to **add historical data to the production table**. Running multiple times will add the values multiple times, inflating counters.

**Only run this script ONCE per input file.** Use `--resume` flag only to continue after interruption, not to re-run completed backfills.

**Progress tracking:** Shows `[processed/total] success=X errors=Y` to track both successful and failed increments.

### Output Files

- `egress-monthly-aggregates-{from}-{to}.json` - Generated aggregates (from step 1)
- `egress-monthly-aggregates-{from}-{to}-processed.txt` - Progress tracking (from step 2)
- `egress-monthly-aggregates-{from}-{to}-errors.csv` - Errors, if any (from step 2)

### 3. Inspect Egress Usage For A Customer

Get the egress value from the monthly aggregation table and compare it with the value aggregated by Stripe.

**Basic usage:**

```bash
cd billing/scripts/monthly-egress-helpers
node 3-get-customer-egress-from-monthly-table.js customer=did:mailto:gmail.com:example month=2026-03
```

**Output:**
- Shows egress totals from monthly aggregation table (per-space breakdown)
- Shows egress total from Stripe billing
- Compares the two values and reports any discrepancies

**With raw events verification:**

```bash
node 3-get-customer-egress-from-monthly-table.js customer=did:mailto:gmail.com:example month=2026-03 --calculateFromRaw
```

**Additional output when using `--calculateFromRaw`:**
- Calculates egress from raw events table (source of truth)
- Compares all three sources: monthly table, Stripe, and raw events
- Identifies over-counting (duplicate event processing) or under-counting issues
- Shows percentage differences for each comparison

**When to use `--calculateFromRaw`:**
- Investigating discrepancies between monthly aggregates and Stripe
- Diagnosing duplicate event processing issues
- Verifying monthly aggregation accuracy

**Note:** Calculating from raw events is slower (queries raw events table) but provides the most accurate verification.
