# Backfill Egress Monthly Summary

Two-step process to populate `egress-traffic-monthly` table from historical raw events.

## Context

The `egress-traffic-monthly` table provides pre-aggregated egress data for fast "egress this month" queries.
This backfill populates historical data from the raw `egress-traffic-events` table.

## Prerequisites

- AWS credentials configured
- `.env.local` file with required environment variables:
  - `STORACHA_ENV`
  - `AWS_REGION`

## Usage

### Step 1: Read Events (Safe, Re-runnable)

Generate aggregates file from raw events:

```bash
cd billing/scripts/backfill-egress-monthly
node 1-read-events.js from=2024-01-01 to=2026-03-01
```

**Output:** `egress-monthly-aggregates-2024-01-01-2026-03-01.json`

This script is READ-ONLY and safe to re-run multiple times.

### Step 2: Write Aggregates (Idempotent, Resumable)

Write aggregates to monthly table:

```bash
node 2-write-aggregates.js input=egress-monthly-aggregates-2024-01-01-2026-03-01.json
```

**Optional: Skip already-processed keys with --resume flag:**

```bash
node 2-write-aggregates.js input=egress-monthly-aggregates-2024-01-01-2026-03-01.json --resume
```

This script uses DynamoDB SET operation (not ADD), making it **fully idempotent**. Safe to re-run anytime - it will overwrite with absolute values rather than accumulating.

### Output Files

- `egress-monthly-aggregates-{from}-{to}.json` - Generated aggregates (from step 1)
- `egress-monthly-aggregates-{from}-{to}-processed.txt` - Progress tracking (from step 2)
- `egress-monthly-aggregates-{from}-{to}-errors.csv` - Errors, if any (from step 2)

## Important Notes

- ✅ **Idempotent:** Step 2 uses SET operation - safe to re-run anytime without inflating counters
- ✅ **Resumable:** If step 2 is interrupted, use `--resume` flag to skip already-processed keys (for efficiency)
- ✅ **Safe separation:** Review aggregates file before writing to database
- 🔄 **Recommended:** Run step 1 first, verify output, then run step 2
- 💡 **How it works:** Each aggregate is a complete total (from step 1). SET overwrites with absolute values, not increments.
