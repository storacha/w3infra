# Storage Billing Architecture

> **Last Updated:** 2026-03-09

This document describes the **storage billing** architecture in w3infra - the daily billing system for time-weighted storage usage. It covers how the system evolved from monthly to daily billing, how usage is calculated, tracked, and reported to Stripe.

**For egress billing** (data downloads), see @docs/egress-billing.md.

## Overview: From Monthly to Daily Billing

### What Changed

The billing system evolved from a **monthly billing model** to a **daily billing model** in February 2026. While the fundamental calculation algorithm remained the same, the execution frequency and data accumulation patterns changed significantly.

**Old (Monthly) System:**
- Cron trigger: 1st of each month at 00:00 UTC
- Billing period: entire previous month (e.g., Feb 1 - Mar 1)
- Snapshots: generated once per month at month boundaries
- Usage records: one record per space per month
- Stripe reporting: single meter event per space per month

**New (Daily) System:**
- Cron trigger: every day at 01:00 UTC
- Billing period: previous day (e.g., Feb 25 00:00 - Feb 26 00:00 UTC)
- Snapshots: generated daily at period boundaries
- Usage records: one record per space per day
- Stripe reporting: daily meter events with delta calculations

### Why the Change

The primary driver was **operational resilience** in the face of high-volume spaces. The RFC (usage-calculation-timeout.md) identified three core problems with monthly billing:

1. **Timeout failures**: Spaces with millions of diff entries would cause Lambda timeouts when aggregating a full month of changes
2. **Manual intervention**: The team had to run ad-hoc compaction scripts to merge diffs before billing runs
3. **Poor error recovery**: A single failure meant re-running the entire month's calculation

Daily billing solves these by:
- Reducing the number of diffs processed per run (1 day instead of 30)
- Creating natural checkpoints (snapshots) every day for incremental recovery
- Enabling faster detection of billing failures (within 24 hours instead of 30 days)
- Allowing Stripe to see usage reports daily instead of waiting until month-end

The tradeoff is increased infrastructure load, but this is acceptable given Lambda's low cost and the improved reliability.

## Architecture Diagram

The billing system consists of three major subsystems: real-time usage tracking, daily calculation pipeline, and Stripe integration.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      REAL-TIME USAGE TRACKING                                │
└─────────────────────────────────────────────────────────────────────────────┘

   Client Upload                             Legacy UCAN Receipts
   (blob/accept, blob/remove)                (store/add, store/remove)
          │                                            │
          ▼                                            ▼
   ┌──────────────────┐                      ┌──────────────────┐
   │  Blob Registry   │                      │  UCAN Stream     │
   │  (Transactional) │                      │  (Kinesis)       │
   └──────────────────┘                      └──────────────────┘
          │                                            │
          │ TransactWrite                              │ Lambda batch
          │ (ACID)                                     │ (eventual)
          ▼                                            ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                         space-diff table                                 │
   │  PK: provider#space    SK: receiptAt#cause                              │
   │  Fields: { space, provider, subscription, cause, delta, receiptAt }     │
   │                                                                           │
   │  Each row = one storage change event (bytes added or removed)           │
   └─────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                     DAILY BILLING CALCULATION PIPELINE                       │
└─────────────────────────────────────────────────────────────────────────────┘

   CloudWatch Cron (daily 01:00 UTC)
   OR HTTP: /billing-cron?from=ISO&to=ISO
          │
          ▼
   ┌───────────────────────┐
   │ billing-cron-handler  │ ← Lists all customers from customer table
   │ Timeout: 15 min       │   (pagination: 1000/page)
   └───────────────────────┘   Filters: customers with Stripe account only
          │
          │ Enqueues: { customer, account, product, from, to }
          ▼
   ┌─────────────────────────────┐
   │  customer-billing-queue     │ (DLQ: maxReceiveCount=3, retention=14d)
   └─────────────────────────────┘
          │
          ▼
   ┌────────────────────────────────┐
   │ customer-billing-queue-handler │ ← Discovers spaces per customer
   │ Batch size: 1                  │   (via subscription + consumer tables)
   │ Timeout: 15 min                │
   └────────────────────────────────┘
          │
          │ Enqueues: { customer, account, product, provider, space, from, to }
          ▼
   ┌─────────────────────────────┐
   │  space-billing-queue        │ (DLQ: maxReceiveCount=3, retention=14d)
   └─────────────────────────────┘
          │
          ▼
   ┌────────────────────────────────┐
   │ space-billing-queue-handler    │ ← calculatePeriodUsage()
   │ Batch size: 1                  │   storeSpaceUsage()
   │ Timeout: 15 min                │
   └────────────────────────────────┘
          │
          │ (1) Loads snapshot at 'from' date (or older)
          │ (2) Iterates space-diff entries for period
          │ (3) Calculates byte-millisecond usage and bytes size
          │
          ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  Writes:                                                          │
   │  • space-snapshot (recordedAt = to, size = final bytes)          │
   │  • usage record (cumulative byte-ms from month start)            │
   └──────────────────────────────────────────────────────────────────┘
          │
          ▼
   ┌─────────────────────────────┐
   │  usage table                │ ← PK: customer, SK: from#provider#space
   │  (DynamoDB Stream enabled)  │   Fields: { usage (byte-ms), account, ... }
   └─────────────────────────────┘
          │
          │ DynamoDB Stream (INSERT events only)
          ▼
   ┌────────────────────────────┐
   │ usage-table-handler        │ ← Converts usage to Stripe meter events
   │ Batch size: 1              │   Calculates delta from previous day
   │ Timeout: 15 min            │   Handles month boundaries
   │ Retry: 10 attempts         │
   └────────────────────────────┘
          │
          │ POST meter event with idempotency key
          ▼
   ┌─────────────────────────────┐
   │  Stripe Billing Meter API   │
   │  Meter: storage_in_bytes_   │
   │         per_month           │
   └─────────────────────────────┘
          │
          │ Stripe aggregates daily events into monthly invoice
          ▼
   Customer Invoice (end of month)
```

## Usage Calculation: The Integral Algorithm

### What We Measure

The billing system measures **cumulative time weighted storage usage** for each space within a billing period. The unit of measurement is **byte-milliseconds** (byte·ms), which represents the integral of storage size over time.

Conceptually, if a user stores 1 GB for 1 day, that equals 1 GB × 86,400,000 ms = 86.4 trillion byte·ms.

### Units and Conversions

**Internal representation (DynamoDB usage table):**
- Stored as: `bigint` byte-milliseconds
- Cumulative from month start
- Example: On Feb 15, the usage field contains total byte·ms from Feb 1 00:00 to Feb 15 00:00

**Stripe representation (meter events):**
- Reported as: integer bytes (change in month-to-date average)
- Delta calculation:
  - Current month-to-date average = `cumulativeByteMs / (to - monthStart)`
  - Previous month-to-date average = `previousCumulativeByteMs / (from - monthStart)`
  - Delta = current average - previous average
- Stripe sums these deltas to reconstruct the final month-to-date average

### The Calculation Algorithm

The core algorithm is implemented in `billing/lib/space-billing-queue.js` in the `calculatePeriodUsage` function. It follows these steps:

**Phase 1: Load Initial State**

The system attempts to load a space snapshot at the billing period start date. A snapshot represents the total size of a space at a specific point in time.

If an exact snapshot exists for the `from` date, it's used directly. If not, the system queries up to 31 snapshots in reverse chronological order and selects the most recent one where `recordedAt <= from`. This snapshot fallback mechanism provides resilience against single-day billing failures.

If no valid snapshot exists, the space is assumed to be empty (size = 0). This handles new spaces that have never been billed before.

**Phase 2: Iterate Space Diffs**

The system queries the space-diff table for all changes in the range `[snapshotDate, to)` where `to` is exclusive. Each diff record contains a `delta` (signed integer representing bytes added or removed) and a `receiptAt` timestamp.

The iteration happens in three logical phases:

1. **Replay phase** (if snapshot is older than `from`): Diffs between `snapshotDate` and `from` are summed to reconstruct the size at the billing period start. These diffs update the running size but do not contribute to usage calculation, since they belong to a different period.

2. **Calculation phase**: Diffs within `[from, to)` contribute to usage via the integral formula: `usage += size × intervalMs`. The interval is the time from the previous diff (or `from` if it's the first diff) to the current diff's `receiptAt`.

3. **Termination phase**: Iteration stops when a diff's `receiptAt >= to`.

**Phase 3: Final Interval**

After processing all diffs, there's a final interval from the last diff (or `from` if no diffs exist) to `to`. This represents the final size held constant until the period end: `usage += size × (to - lastDiffTime)`.

**Phase 4: Monthly Accumulation**

The system queries the usage record corresponding to the snapshot date being used (via `findPreviousUsageBySnapshotDate`). This implements cumulative month-to-date tracking:

- **First of month**: Returns `{ usage: 0n, found: true }` (cumulative resets)
- **Normal daily billing**: Finds yesterday's usage record via 24h lookback
- **Snapshot fallback**: Finds the usage record matching the older snapshot date via paginated scan
- **New space**: Returns `{ usage: 0n, found: false }` (no previous billing history)

The current period's usage is then added to the previous cumulative total:
```javascript
cumulativeUsage = previousCumulative + periodUsage
```

This creates month-to-date accumulation: by the end of the month, the usage record for the last day contains the sum of all daily usage from the 1st of the month.

### What Counts Toward Usage

- Every byte stored contributes to usage based on how long it was stored
- Additions (blob/accept events) increase the running size
- Removals (blob/remove events) decrease the running size
- The `receiptAt` timestamp determines when the change occurred

### Snapshot Lookup and Resilience

The snapshot fallback mechanism (fetching 31 snapshots instead of 1) was added to handle operational failures. If a billing run fails on Feb 25, the system can still calculate usage on Feb 26 by:

1. Loading the snapshot from Feb 24
2. Replaying diffs from Feb 24-25 to reconstruct the size at Feb 25 00:00
3. Calculating usage for Feb 25-26
4. Adding to the cumulative total from Feb 24

**Usage Gap Detection:**

The `usage-table-handler` validates the lookup result to detect data loss:
- If `found: false` is returned for a space that should have previous usage (mid-month, not first billing), it throws an error
- This prevents silent data loss: cumulative usage must form an unbroken chain mid-month
- A missing usage record indicates either data loss or operational failure requiring manual investigation

The combination of snapshot fallback (for operational resilience) and usage gap detection (for data integrity) creates a defense-in-depth approach to billing reliability.

## Usage Table: Cumulative State Tracking

### Table Schema

**Primary Key:**
- PK: `customer` (DID, e.g., `did:mailto:alice@example.com`)
- SK: `from#provider#space` (composite key, e.g., `2026-02-25T00:00:00.000Z#did:web:web3.storage#did:key:z6Mk...`)

**Attributes:**
- `customer`: Customer DID
- `account`: Stripe account ID (e.g., `stripe:cus_abc123`)
- `product`: Billing plan
- `provider`: Storage provider DID
- `space`: Space DID
- `from`: Billing period start (Date)
- `to`: Billing period end (Date)
- `usage`: Cumulative byte-milliseconds from month start (bigint)
- `insertedAt`: Record creation timestamp (Date)

**DynamoDB Stream:**
- Enabled for INSERT events only
- Triggers `usage-table-handler` Lambda
- Retry attempts: 3 (before DLQ)

### How Rows Are Written

One row is written per space per day by the `space-billing-queue-handler` Lambda.
The `storeSpaceUsage` function in `billing/lib/space-billing-queue.js` writes the record after calculating usage. The write happens atomically with the snapshot write (though not in a transaction).

### How Rows Are Read

**By the billing system (daily):**

The `usage-table-handler` Lambda reads the previous usage record to calculate the delta for Stripe using the `findPreviousUsageBySnapshotDate` function from `billing/lib/usage-calculations.js`. This function implements a two-tier lookup strategy:

**Tier 1: 24-hour lookback (optimized for daily billing):**
- Calculates `previousFrom = targetDate - 24 hours`
- Attempts direct lookup: `usageStore.get({ customer, from: previousFrom, provider, space })`
- Verifies the record's `to` field equals the `targetDate` (the snapshot date being used)
- If match found, returns the usage immediately (single DynamoDB read)

**Tier 2: Paginated scan (fallback for snapshot fallback scenarios):**
- If quick lookup fails, scans usage records for the customer in reverse chronological order
- Searches for a record where `record.to === targetDate` AND matches the space/provider
- Includes early termination if all records are older than 1 month before target
- Returns `{ usage: 0n, found: false }` if no matching record found (new space or month start)

This approach ensures:
- **Fast common case**: Daily billing resolves in a single read
- **Resilient edge case**: Snapshot fallback (using older snapshots) still finds the correct previous usage
- **Bounded scan**: Pagination prevents full table scans while handling irregular billing periods
- **Throttling protection**: Adaptive pacing prevents sustained high read pressure on DynamoDB

**Error handling:**
- If `found: false`, the system treats it as a new space (first billing) or month start (cumulative reset)
- The `usage-table-handler` validates this: if a previous record should exist but wasn't found, it throws an error to prevent data loss
- This ensures cumulative usage forms an unbroken chain mid-month

## Stripe Integration

### What Stripe Expects

Stripe's billing meters API (v2025-02-24.acacia) expects meter events in this format:

```
{
  event_name: 'storage_in_bytes_per_month',
  timestamp: Unix epoch seconds,
  identifier: idempotency key,
  payload: {
    stripe_customer_id: 'cus_abc123',
    bytes: '1073741824'  // average bytes for the period
  }
}
```

**Key constraints:**
- `timestamp`: Must be in the past, not more than 2 days old
- `identifier`: Idempotency key valid for 24 hours
- `bytes`: String representation of an integer (no decimals)

Stripe aggregates these events by customer and billing period (monthly). At the end of the month, the total is used to calculate overage charges.

### Data Format and Conversion

The conversion from byte-milliseconds to bytes happens in `usage-table-handler.js` using the `calculateDeltaMetrics` function from `billing/lib/usage-calculations.js`. This is a **critical calculation** that determines what gets billed.

**The Algorithm:**

The delta represents the **change in the month-to-date average storage** caused by adding one more day of usage:

1. **Find previous cumulative usage**: Query usage table for the record at the snapshot date (or 0n if first of month)
2. **Calculate month-to-date durations**:
   - `currentCumulativeDuration = to - monthStart` (e.g., Feb 1 → Feb 25 = 24 days)
   - `previousCumulativeDuration = from - monthStart` (e.g., Feb 1 → Feb 24 = 23 days)
3. **Calculate cumulative averages** (bytes stored on average from month start):
   - `currentAverage = currentCumulative / currentCumulativeDuration`
   - `previousAverage = previousCumulative / previousCumulativeDuration`
4. **Calculate delta**: `deltaBytes = currentAverage - previousAverage`
5. **Floor to integer**: `Math.floor(deltaBytes)`
6. **Convert to string**: Required by Stripe API

**Why This Works:**

Stripe sums all the deltas we send throughout the month. The sum of these deltas equals the month-to-date average storage on the last day:

```
Sum of all daily deltas = Final month-to-date average
```
This approach enables **incremental reporting** while maintaining **cumulative semantics**.

The delta calculation is critical because Stripe expects **changes in the monthly average**, not raw daily usage. This approach correctly handles:
- Variable storage amounts each day
- Month boundaries (reset on 1st)
- Deleted data (negative deltas)
- Zero usage days (zero deltas, skipped)

### When Data Is Sent

Data flows to Stripe via a DynamoDB stream trigger:

1. `space-billing-queue-handler` writes usage record to usage table
2. DynamoDB stream emits INSERT event
3. `usage-table-handler` Lambda receives event (usually within seconds)
4. Lambda validates Stripe customer status (`validateStripeCustomerForBilling`)
5. Lambda queries previous cumulative usage (`findPreviousUsageBySnapshotDate`)
6. Lambda calculates delta metrics (`calculateDeltaMetrics`)
7. Lambda sends meter event to Stripe API (if delta is non-zero)
8. Stripe returns 200 OK or error

**Retry behavior:**
- DynamoDB stream retries: 3 attempts with exponential backoff
- Idempotency: Same event can be sent multiple times (24-hour window)
- DLQ: Failed events after 3 retries go to dead letter queue

**Edge cases handled by `validateStripeCustomerForBilling`:**
- **Deleted Stripe customer**: Log error with manual review notice, skip billing (return success, no retry)
- **All subscriptions inactive** (canceled or paused): Log error with manual review notice, skip billing (return success, no retry)
- **Past-due subscription**: Log warning, continue with billing (usage still reported for later collection)
- **Zero delta**: Skip sending (no usage change from previous day)
- **Negative delta**: Send as-is (user deleted data, reduces monthly average)
- **Missing previous usage record** (mid-month): Throw error to prevent data loss (usage chain must be unbroken)

## Execution Model

### Default: Daily Calculation

By default, billing runs daily at 01:00 UTC via CloudWatch cron: `cron(0 1 * * ? *)`.

The billing period is always the previous day:
- `from`: yesterday at 00:00 UTC
- `to`: today at 00:00 UTC

Example: Cron fires at Feb 26 01:00 UTC → calculates usage for Feb 25 00:00 - Feb 26 00:00.

This 1-hour offset (trigger at 01:00 instead of 00:00) ensures that any diff events with `receiptAt` near midnight have time to be written to the space-diff table before the billing run starts.

### Alternative Periods: Flexibility for Operational Needs

The system supports flexible billing periods via HTTP query parameters:

```
GET /billing-cron?from=2026-02-01T00:00:00.000Z&to=2026-02-08T00:00:00.000Z
GET /billing-cron?from=2026-02-25T00:00:00.000Z&to=2026-02-26T00:00:00.000Z&customer=did:mailto:user@example.com
```

**Supported parameters:**
- `from` (required): Start date in ISO 8601 format
- `to` (required): End date in ISO 8601 format
- `customer` (optional): Customer DID to process only a specific customer

**Supported billing periods:**
- **Daily**: Single day (e.g., Feb 25 00:00 - Feb 26 00:00)
- **Multi-day intervals**: Multiple consecutive days within the same month (e.g., Feb 15-20)
- **Monthly**: Full month starting from the 1st (e.g., Feb 1 00:00 - Mar 1 00:00)

**Important constraint:**
- Multi-day periods must be within the same month for correct cumulative usage tracking

The calculation logic adapts automatically based on the period.
