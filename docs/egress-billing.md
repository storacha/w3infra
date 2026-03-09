# Egress Billing System

> **Last Updated:** 2026-03-09

This document describes how egress (data downloads) is tracked, stored, aggregated, and billed through Stripe in the w3infra system.

---

## Overview

Egress billing tracks **bytes served to users** when they download content through the Storacha/Freeway gateway. Unlike storage billing (time-weighted, cumulative), egress is **event-based and incremental** — each download triggers a discrete billing event.

**Key characteristics:**

- **Trigger**: Real-time per download request (not cron-based)
- **Processing**: Event-driven via SQS queue (async, decoupled from gateway response)
- **Unit**: Bytes transferred (simple count, no time weighting)
- **Billing**: Reported to Stripe Billing Meters API
- **Storage**: Two tables (raw events + monthly aggregates)

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    EGRESS BILLING PIPELINE                    │
└──────────────────────────────────────────────────────────────┘

User downloads file
        │
        ▼
┌────────────────────────┐
│   Freeway Gateway      │  (External service - serves content)
│  - Serves bytes to user│
│  - Captures metadata   │
│  - ctx.waitUntil(...)  │
└──────────┬─────────────┘
           │ (async POST - usage/record UCAN capability)
           ▼
┌────────────────────────┐
│ UCAN Invocation Router │  upload-api/functions/ucan-invocation-router.js
│  - Routes capability   │
│  - Calls service       │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ UsageStorage.record()  │  upload-api/stores/usage.js:107-124
│  - Validates event     │
│  - Enqueues to SQS     │
│  - Returns immediately │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│   SQS Queue            │  Config: batch 10, visibility 15min
│  egress-traffic-queue  │  Max retries: 3 → DLQ
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│  Lambda Handler        │  billing/functions/egress-traffic-queue.js
│  1. Decode event       │
│  2. Save raw event     │  (conditional write)
│  3. Increment monthly  │  (atomic ADD)
│  4. Lookup customer    │
│  5. Send to Stripe     │  (with retry)
└──────────┬─────────────┘
           │
    ┌──────┴─────────┬──────────┐
    │                │          │
    ▼                ▼          ▼
┌──────────┐  ┌──────────┐  ┌────────┐
│DynamoDB  │  │DynamoDB  │  │ Stripe │
│egress-   │  │egress-   │  │ Meter  │
│traffic   │  │traffic-  │  │ Events │
│(events)  │  │monthly   │  │  API   │
└──────────┘  └──────────┘  └────────┘
 Raw events    Aggregates    Billing
```

### Component Map

| Component | File | Purpose | When Involved |
| --------- | ---- | ------- | ------------- |
| **Freeway Gateway** | External | Serves content to users | Every download request |
| **UCAN Router** | upload-api/functions/ucan-invocation-router.js | Routes `usage/record` capability | Receives egress events from Freeway |
| **UsageStorage** | upload-api/stores/usage.js:107-124 | Enqueues events to SQS | Immediately after Freeway reports |
| **SQS Queue** | billing/queues/egress-traffic.js | Async processing buffer | Decouples gateway from billing |
| **Queue Handler** | billing/functions/egress-traffic-queue.js | Processes events in batches | Triggered by SQS (10 events/batch) |
| **Events Table** | billing/tables/egress-traffic.js | Raw event storage (source of truth) | Every event saved once |
| **Monthly Table** | billing/tables/egress-traffic-monthly.js | Pre-aggregated counters | Every event increments monthly total |
| **Stripe Utils** | billing/utils/stripe.js:140-204 | Meter event API calls | After customer lookup |

---

## Data Flow Walkthrough

### Step 1: Freeway Captures Download

**External system**: Freeway Gateway

When a user downloads a file:

1. Freeway serves the bytes to the user
2. Tracks: space DID, customer DID, resource CID, bytes, timestamp, cause (UCAN invocation ID)
3. Uses `ctx.waitUntil()` to asynchronously invoke `usage/record` UCAN capability
4. User's download completes (not blocked by billing)

**Event structure sent to w3infra:**

The event contains six fields: space DID (the space being billed), customer DID (the customer to bill), resource (the CID that was served), bytes (number of bytes transferred), servedAt (timestamp when served), and cause (the UCAN invocation ID that triggered the egress). Space DIDs use the `did:key` format, while customer DIDs use `did:mailto` format.

### Step 2: Upload API Receives Event

**File**: upload-api/stores/usage.js:107-124

The `usage/record` UCAN capability is handled by `UsageStorage.record()`. This method receives the six event parameters, creates a record object, and immediately enqueues it to the SQS egress-traffic-queue. The method returns success immediately without waiting for processing—this ensures the gateway response isn't blocked by billing operations.

**What happens:**

- Event is validated and encoded using billing/data/egress.js:45-55
- Enqueued to SQS `egress-traffic-queue`
- Returns success immediately (async processing)

**Encoding details** (billing/data/egress.js:22-42):

### Step 3: Lambda Processes Queue

**File**: billing/functions/egress-traffic-queue.js

**Trigger**: SQS batch (up to 10 events, visibility timeout 15 min)

For each event in batch:

**3a. Decode** (lines 66-67)

The handler receives the SQS record, extracts the body, and decodes it from JSON string to object. The decoded data is then validated to ensure it contains all required fields.

**3b. Save raw event with idempotency check** (lines 85-95)

The raw event is saved to the egress-traffic table using a conditional write that specifies `conditionFieldsMustNotExist` for both pk and sk fields. If the event already exists (e.g., on a retry), DynamoDB throws `ConditionalCheckFailedException`. The handler catches this specific exception, logs that it's a retry scenario, and continues processing rather than failing. This allows the monthly increment (Phase 2) to proceed even when the raw event already exists.

**3c. Extract month and increment monthly aggregate** (lines 69-105)

The handler extracts the month in YYYY-MM format from the servedAt timestamp (e.g., "2026-03"). It then calls the monthly store's `increment()` method. This operation uses DynamoDB's atomic ADD operation to increment the monthly counter.

**3d. Lookup customer's Stripe account** (lines 108-123)

The handler queries the customer table to find the Stripe account associated with the customer DID. If the customer is not found, a warning is logged but processing continues—the event is saved to DynamoDB but not billed to Stripe.

**3e. Send meter event to Stripe** (lines 113-121)

If a customer account was found, the handler calls `recordBillingMeterEvent()` with the stripe client, billing meter name ("gateway-egress-traffic"), egress data, and customer account. This creates a meter event in Stripe's Billing Meters API.

**Error handling:**

- Any failure → record added to `batchItemFailures`
- SQS retries up to 3 times
- After max retries → Dead Letter Queue (14 day retention)

### Step 4: Stripe Records Billing

**File**: billing/utils/stripe.js:140-204

**Idempotency key generation** (lines 156-157):

To prevent duplicate billing, the system creates a deterministic idempotency key. This string is then hashed using SHA-256 to produce a 64-character hex string that stays well under Stripe's 255-character limit.

**Meter event creation** (lines 162-175):

The meter event is created with the event name "gateway-egress-traffic", a payload containing the Stripe customer ID and the byte count as a string (Stripe requires the value to be a string, not a number), and a timestamp in Unix seconds (not milliseconds—the JavaScript milliseconds timestamp must be divided by 1000 and floored). The idempotency key is passed in the options to enable Stripe's 24-hour deduplication window.

**Retry logic** (lines 160-191):

The meter event creation is wrapped in `p-retry` with exponential backoff. It will retry up to 5 times with delays starting at 1 second and doubling each time (~1s, ~2s, ~4s, ~8s, ~16s), with random jitter added to prevent thundering herd. The retry logic only triggers for `StripeRateLimitError`—other errors fail immediately. The maximum timeout is capped at 30 seconds.

---

## Storage Schema

### Table 1: egress-traffic (Raw Events)

**Purpose**: Immutable source of truth for every egress event

**File**: billing/tables/egress-traffic.js:11-43

**Schema:**

- **PK**: `{space}#{resource}` — Example: `did:key:z6Mk...#bafybeib...`
- **SK**: `{servedAt}#{cause}` — Example: `2026-03-09T14:23:15.000Z#bafyreic...`
- **Attributes**: space, customer, resource, bytes, servedAt, cause

**Global Secondary Indexes:**

1. **customer-index** — Query all egress by customer
   - PK: `customer`, SK: `sk`
   - Use: Customer billing reports

2. **space-index** — Query egress by space + time range
   - PK: `space`, SK: `servedAt`
   - Use: `sumBySpace()` for usage reports (billing/tables/egress-traffic.js:65-105)

**Key operations:**

The table supports saving events with conditional writes by specifying `conditionFieldsMustNotExist` for both pk and sk fields. This prevents duplicate raw events from being stored. The table also supports summing egress for a space within a time period using the space-index GSI, which allows efficient BETWEEN queries on the servedAt field. An optional monthly store parameter enables fast aggregation without scanning individual events.

### Table 2: egress-traffic-monthly (Aggregates)

**Purpose**: Fast monthly aggregation without scanning raw events

**File**: billing/tables/egress-traffic-monthly.js:11-34

**Schema:**

- **PK**: `customer#{customer-did}` — Example: `customer#did:mailto:user@example.com`
- **SK**: `{YYYY-MM}#{space-did}` — Example: `2026-03#did:key:z6Mk...`
- **Attributes**:
  - `space` (for GSI)
  - `month` (for GSI)
  - `bytes` (atomic counter)
  - `eventCount` (atomic counter)

**Global Secondary Index:**

**space-month-index** — Fast lookup by space

- PK: `space`, SK: `month`
- Use: `sumBySpace()` without scanning raw events (billing/tables/egress-traffic-monthly.js:102-136)

**Atomic increment** (billing/tables/egress-traffic-monthly.js:56-93):

The increment operation uses DynamoDB's UpdateExpression with SET and ADD operations. It sets the space and month fields (to ensure they exist for the GSI), then atomically adds the byte count to the bytes field and increments the eventCount field by 1. This happens in a single atomic operation.

**Why atomic ADD?**

- No read-modify-write cycle needed
- Concurrent events counted correctly
- But: **NOT idempotent** (retries will double-count)

**Query methods:**

- `increment({ customer, space, month, bytes })` — Add to monthly total
- `sumBySpace(space, period)` — Get total bytes for space (uses GSI)
- `listByCustomer(customer, month)` — Get all spaces for customer/month

---

## Idempotency & Duplicate Handling

### Two-Phase Protection

The system uses **two-phase idempotency** to handle SQS retries:

**Phase 1: Raw event storage**

- Conditional write with `conditionFieldsMustNotExist: ['pk', 'sk']`
- If event exists → `ConditionalCheckFailedException`
- On retry: exception caught, logged, processing continues

**Phase 2: Monthly aggregate increment**

- Atomic `ADD` operation
- Always runs, even if Phase 1 failed (retry scenario)

### Retry Scenarios

**Scenario 1: First attempt (no retries)**

- Phase 1 succeeds → Raw event saved
- Phase 2 succeeds → Monthly counter incremented
- ✅ Event counted once

**Scenario 2: Retry after Phase 1 success, Phase 2 failure**

- Phase 1 fails with `ConditionalCheckFailedException` (event exists)
- Handler catches exception, continues
- Phase 2 succeeds → Monthly counter incremented
- ✅ Event counted once

### Critical Limitation

> ⚠️ **The source (Freeway Gateway) MUST NOT send duplicate events**

**This idempotency pattern only protects against SQS retries**, not duplicate source events.

---

## Usage Reports

**File**: upload-api/stores/usage.js:75-94

The upload-api provides egress reports via `UsageStorage.reportEgress()`, which delegates to `egressTrafficStore.sumBySpace()` with an optional monthly store parameter for fast aggregation.

**Implementation details** (billing/tables/egress-traffic.js:65-105):

**If monthly store provided** (fast path):

Uses `monthlyStore.sumBySpace()` which queries the `space-month-index` GSI and returns the pre-aggregated total directly without scanning individual events.

**If monthly store NOT provided** (fallback):

Scans raw events using the `space-index` GSI with a BETWEEN query on the servedAt field. Paginates through results using ExclusiveStartKey and sums the bytes from all matching events.

**Performance:**

- Fast path: O(months) — typically 1-2 queries
- Slow path: O(events) — could be thousands of queries for high-volume spaces

---

### Feature Flag

Set environment variable to disable Stripe reporting: `SKIP_STRIPE_EGRESS_TRACKING=true`

**Use cases:**

- Development/testing environments
- Debugging without affecting Stripe
- Temporary Stripe outages

**Behavior when enabled** (billing/functions/egress-traffic-queue.js:113-120):

- Still saves to DynamoDB (raw + monthly)
- Skips Stripe API call
- Logs warning

---

### Monitoring

**CloudWatch Logs:**

Logs are available at `/aws/lambda/prod-w3infra-BillingStack-egresstrafficqueuehandler-*`

**CloudWatch Metrics:**

- SQS: `ApproximateNumberOfMessagesVisible` (queue depth)
- SQS: `ApproximateNumberOfMessagesNotVisible` (in-flight)
- Lambda: `Errors` (handler failures)
- Lambda: `Duration` (processing time)

**Dead Letter Queue:**

- Name: `egress-traffic-dlq`
- Retention: 14 days
- Max retries before DLQ: 3

**Stripe Dashboard:**

- Meters: https://dashboard.stripe.com/meters
- Search: `gateway-egress-traffic`
- View aggregates by customer

---

## Edge Cases & Gotchas

### 1. Customer Not Found

**File**: billing/functions/egress-traffic-queue.js:108-123

If the customer lookup fails, the handler logs a warning message stating that it received an egress event but couldn't find the customer in the database. The event is still saved to the raw events table and the monthly aggregate is still incremented, but the Stripe API call is skipped because there's no account to bill. Processing continues without failing, preventing the message from going to the DLQ.

**Implication**: Event tracked but not billed → lost revenue

### 2. Source Duplicate Events

> **Critical**: Freeway MUST NOT send duplicate events

**The problem:**

Idempotency protection only handles SQS retries, not duplicate events from the source. If Freeway sends the same download twice (for example, due to a bug or retry logic), both events will be counted and billed.

---

## Configuration Reference

### Environment Variables

| Variable | Required | Source | Example |
| -------- | -------- | ------ | ------- |
| `STRIPE_BILLING_METER_EVENT_NAME` | Yes | Billing stack | `gateway-egress-traffic` |
| `STRIPE_SECRET_KEY` | Yes | Config/SSM | `sk_live_...` |
| `EGRESS_TRAFFIC_QUEUE` | Yes | Upload API stack | `https://sqs.us-west-2.amazonaws.com/...` |
| `EGRESS_TRAFFIC_TABLE_NAME` | Yes | Billing stack | `prod-w3infra-egress-traffic` |
| `EGRESS_TRAFFIC_MONTHLY_TABLE_NAME` | Yes | Billing stack | `prod-w3infra-egress-traffic-monthly` |
| `CUSTOMER_TABLE_NAME` | Yes | Billing stack | `prod-w3infra-customer` |
| `SKIP_STRIPE_EGRESS_TRACKING` | No | Manual | `true` (disables Stripe calls) |
| `AWS_REGION` | Yes | Runtime | `us-west-2` |

### Queue Configuration

**File**: stacks/billing-stack.js:222-233

The queue processes 10 events per Lambda invocation. The visibility timeout is 15 minutes, giving the handler that much time to process the batch before the messages become visible again. The max receive count is 3, meaning messages are retried 3 times before being sent to the DLQ. The DLQ retains failed messages for 14 days.

### Stripe API

- **API Version**: `2025-02-24.acacia` (billing/functions/egress-traffic-queue.js:62)
- **Rate limits**: ~100 requests/second (standard tier)
- **Idempotency window**: 24 hours
- **Max idempotency key**: 255 characters

---

## File Reference Index

### Event Source

- **Freeway invocation**: External (freeway.dag.haus)
- **UCAN Router setup**: upload-api/functions/ucan-invocation-router.js
- **UsageStorage.record**: upload-api/stores/usage.js:107-124
- **Queue client**: billing/queues/egress-traffic.js

### Raw Event Storage

- **Table schema**: billing/tables/egress-traffic.js:11-43
- **Store methods**: billing/tables/egress-traffic.js:50-106
- **sumBySpace**: billing/tables/egress-traffic.js:65-105
- **Data encoding**: billing/data/egress.js:22-42
- **Data validation**: billing/data/egress.js:10-20

### Monthly Aggregation

- **Table schema**: billing/tables/egress-traffic-monthly.js:11-34
- **Increment method**: billing/tables/egress-traffic-monthly.js:56-93
- **sumBySpace (GSI)**: billing/tables/egress-traffic-monthly.js:102-136
- **listByCustomer**: billing/tables/egress-traffic-monthly.js:145-186
- **Data encoding**: billing/data/egress-monthly.js:64-81
- **extractMonth util**: billing/data/egress-monthly.js:115-117

### Processing Pipeline

- **Queue handler**: billing/functions/egress-traffic-queue.js:39-137
- **Idempotency logic**: billing/functions/egress-traffic-queue.js:85-95
- **Monthly increment call**: billing/functions/egress-traffic-queue.js:97-105
- **Customer lookup**: billing/functions/egress-traffic-queue.js:108-123
- **Stripe call**: billing/functions/egress-traffic-queue.js:113-121

### Stripe Integration

- **recordBillingMeterEvent**: billing/utils/stripe.js:140-204
- **Idempotency key**: billing/utils/stripe.js:156-157
- **Retry logic**: billing/utils/stripe.js:160-191
- **Error handling**: billing/utils/stripe.js:144-151

### Infrastructure

- **Billing stack**: stacks/billing-stack.js:203-242
- **Upload API stack**: stacks/upload-api-stack.js:110-318
- **Queue config**: stacks/billing-stack.js:222-233

### Testing

- **Test helpers**: billing/test/helpers/egress.js
- **Integration test**: billing/test/lib/egress-traffic.js

---

## Related Systems

- **Space Billing**: Storage usage billing (separate pipeline, cron-based)
- **Customer Table**: Maps customer DIDs to Stripe accounts
- **UCAN Stream**: Processes UCAN invocations (includes space-diff, not egress)
- **Stripe Billing Meters**: External billing aggregation service
- **Freeway Gateway**: External content delivery service (source of egress events)
