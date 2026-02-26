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
  - `EGRESS_TRAFFIC_TABLE_NAME`
  - `EGRESS_TRAFFIC_MONTHLY_TABLE_NAME`

## Usage

### Step 1: Read Events (Safe, Re-runnable)

Generate aggregates file from raw events:

```bash
cd billing/scripts/backfill-egress-monthly
node 1-read-events.js from=2024-01-01 to=2026-03-01
```

**Output:** `egress-monthly-aggregates-2024-01-01-2026-03-01.json`

This script is READ-ONLY and safe to re-run multiple times.

### Step 2: Write Aggregates (One-time, Resumable)

Write aggregates to monthly table:

```bash
node 2-write-aggregates.js input=egress-monthly-aggregates-2024-01-01-2026-03-01.json
```

**If interrupted, resume:**

```bash
node 2-write-aggregates.js input=egress-monthly-aggregates-2024-01-01-2026-03-01.json --resume
```

### Output Files

- `egress-monthly-aggregates-{from}-{to}.json` - Generated aggregates (from step 1)
- `egress-monthly-aggregates-{from}-{to}-processed.txt` - Progress tracking (from step 2)
- `egress-monthly-aggregates-{from}-{to}-errors.csv` - Errors, if any (from step 2)

## Important Notes

- ⚠️ **NOT idempotent:** Running step 2 multiple times will inflate counters (uses ADD operation)
- ✅ **Resumable:** If step 2 is interrupted, use `--resume` flag to continue
- ✅ **Safe separation:** Review aggregates file before writing to database
- 🔄 **Recommended:** Run step 1 first, verify output, then run step 2
