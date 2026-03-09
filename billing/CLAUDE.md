# Billing Module

This file provides quick guidance for AI agents (Claude Code) working with the billing system.

---

## Overview

The billing module handles **two distinct types of billing**:

### 1. Storage Billing (Time-Weighted Usage)
- Tracks how much data is stored and for how long
- Uses **byte-millisecond** units (time-weighted)
- Runs **daily at 01:00 UTC** via cron (batch processing)
- Maintains **cumulative month-to-date** totals
- Reports to Stripe meter: `storage_in_bytes_per_month`

**📚 Detailed documentation**: @docs/storage-billing.md

### 2. Egress Billing (Event-Based)
- Tracks data served/downloaded through the gateway
- Uses simple **byte count** per download
- Processes **real-time events** via SQS queue
- Incremental reporting (no cumulative state)
- Reports to Stripe meter: `gateway-egress-traffic`

**📚 Detailed documentation**: @docs/egress-billing.md

---

## Quick Navigation

| Topic | Location |
|-------|----------|
| **Storage billing deep-dive** | @docs/storage-billing.md |
| **Egress billing deep-dive** | @docs/egress-billing.md |
| **Testing guidance** | @billing/test/CLAUDE.md |
| **File structure** | See below ↓ |
| **Tables reference** | See below ↓ |
| **Critical guidelines** | See below ↓ |

---

## File Structure

```

docs/                         # Deep-dive documentation
├── egress-billing.md             # Egress architecture
└── storage-billing.md            # Storage architecture
billing/
├── functions/           # Lambda handlers (thin wrappers)
│   ├── billing-cron.js           # [STORAGE] Cron trigger → customer queue
│   ├── customer-billing-queue.js # [STORAGE] Customer → space queue
│   ├── space-billing-queue.js    # [STORAGE] Calculate usage
│   ├── usage-table.js            # [STORAGE] DynamoDB stream → Stripe
│   └── egress-traffic-queue.js   # [EGRESS] Process egress events
│
├── lib/                 # Business logic
│   ├── billing-cron.js           # [STORAGE] Customer listing
│   ├── customer-billing-queue.js # [STORAGE] Space discovery
│   ├── space-billing-queue.js    # [STORAGE] Usage calculation (⭐ core logic)
│   ├── util.js                   # [STORAGE] Helpers
│   └── egress-traffic.js         # [EGRESS] Event processing
│
├── lib/store/          # Data access layer (⭐ always use stores, never direct DynamoDB)
│   ├── customer.js     # Customer records
│   ├── space-diff.js   # [STORAGE] Storage changes
│   ├── space-snapshot.js # [STORAGE] Size checkpoints
│   ├── usage.js        # [STORAGE] Month-to-date totals
│   └── egress-traffic-events.js # [EGRESS] Event storage
│
├── tables/             # DynamoDB table definitions (SST)
├── scripts/            # Operational scripts (dry-run, simulations)
└── test/               # Tests (entail) → See @billing/test/CLAUDE.md

```

---

## Tables Quick Reference

### Storage Billing Tables

| Table | Purpose | Key |
|-------|---------|-----|
| `customer` | Stripe account mapping | `customer` (DID) |
| `space-diff` | Real-time storage changes | `provider#space`, `receiptAt#cause` |
| `space-snapshot` | Daily size checkpoints | `provider#space`, `recordedAt` |
| `usage` | Cumulative usage (byte·ms) | `customer`, `from#provider#space` |

### Egress Billing Tables

| Table | Purpose | Key |
|-------|---------|-----|
| `egress-traffic-events` | Individual download events | `space#resource`, `servedAt#cause` |
| `egress-traffic-monthly` | Monthly aggregates (fast queries) | `customer#space#month` |

---

## Core Concepts

### Storage: Byte-Milliseconds
- **Unit**: `byte·ms` = integral of storage size over time
- **Example**: 1 GB for 1 day = 1,073,741,824 bytes × 86,400,000 ms
- **Cumulative**: Resets on 1st of each month

### Storage: Daily Billing Model
- Runs daily (not monthly) to prevent Lambda timeouts
- Creates daily snapshots for resilience
- Reports daily deltas to Stripe

### Egress: Event-Based Model
- Each download = one event
- No time weighting, just byte count
- Two-phase idempotency (conditional writes + Stripe keys)

---

## Critical Guidelines

### General (Both Systems)
1. ⭐ **Always use stores** - Never query DynamoDB directly
2. ⭐ **Maintain idempotency** - All Lambda handlers must handle retries
3. **Test all changes** - Billing logic requires tests (see `test/CLAUDE.md`)
4. **Consider DLQ scenarios** - Failed messages must be recoverable

### Storage Billing
5. **Preserve cumulative semantics** - Usage accumulates across days
6. **Handle month boundaries** - Reset on 1st of month at 00:00 UTC
7. **Use snapshot fallback** - Don't assume exact snapshots exist
8. **Validate byte·ms conversions** - Ensure correct Stripe units

### Egress Billing
9.  **Never send duplicate events** - Source must ensure uniqueness (idempotency only handles retries!)
10. **Use conditional writes** - Always specify `conditionFieldsMustNotExist: ['pk', 'sk']`
11. **Increment monthly aggregates** - Update both raw events and monthly totals
12. **Trust Stripe as source of truth** - Meter events are idempotent

---

## Testing

**See @billing/test/CLAUDE.md for comprehensive testing guidance.**

Quick start:
```bash
# Requires Docker Desktop running
export AWS_REGION='us-west-2' AWS_ACCESS_KEY_ID='NOSUCH' AWS_SECRET_ACCESS_KEY='NOSUCH'

pnpm test                                              # All tests
pnpm run test-only -- 'test/lib.space-billing-queue.spec.js'  # Storage
pnpm run test-only -- 'test/lib.egress-traffic.spec.js'       # Egress
```

**Important**: Always run `.spec.js` files (not implementation files).

---

## Observability

### Stripe Dashboards
- **Storage meter**: https://dashboard.stripe.com/meters → `storage_in_bytes_per_month`
- **Egress meter**: https://dashboard.stripe.com/meters → `gateway-egress-traffic`

### CloudWatch Logs

**Storage:**
- `prod-w3infra-BillingStack-billingcronhandler-*`
- `prod-w3infra-BillingStack-customerbillingqueuehand-*`
- `prod-w3infra-BillingStack-spacebillingqueuehandler-*`
- `prod-w3infra-BillingStack-usagetablehandler-*`

**Egress:**
- `prod-w3infra-BillingStack-egresstrafficqueuehandler-*`

### Dead Letter Queues

**Storage:**
- `customer-billing-dlq` (14 days, max 3 retries)
- `space-billing-dlq` (14 days, max 3 retries)
- `usage-table-dlq` (14 days, max 3 retries)

**Egress:**
- `egress-traffic-dlq` (14 days, max 3 retries)

---

## Architecture Diagrams

### Storage Billing Flow

```
CloudWatch Cron (daily 01:00 UTC)
    ↓
billing-cron-handler (lists customers)
    ↓
customer-billing-queue (enqueues customers)
    ↓
customer-billing-queue-handler (discovers spaces)
    ↓
space-billing-queue (enqueues spaces)
    ↓
space-billing-queue-handler (calculates usage and snapshot)
    ↓
usage-table-handler (DynamoDB stream triggered by INSERT and report to Stripe API)
    ↓
Stripe Billing Meter API (daily delta)
```

### Egress Billing Flow

```
HTTP Request (user downloads data)
    ↓
UCAN Invocation Router
    ↓
UsageStorage.record() (creates event)
    ↓
egress-traffic-queue (SQS)
    ↓
egress-traffic-queue-handler (Lambda)
    ↓
├─> egress-traffic-events (raw events)
├─> egress-traffic-monthly (aggregates)
└─> Stripe Billing Meter API (meter event)
```

---

## Additional Resources

- **Storage billing architecture**: @docs/storage-billing.md (comprehensive)
- **Egress billing architecture**: @docs/egress-billing.md (comprehensive)
- **Testing guidance**: @billing/test/CLAUDE.md (test patterns, helpers, coverage)
