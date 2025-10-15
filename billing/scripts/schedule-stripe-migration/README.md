# Stripe Subscription Migration Script

This script updates customer subscriptions from the legacy single-price plans to the new split pricing model (flat monthly fee + usage overage price) as part of the billing migration to Stripe Billing Meters.

It uses Subscription Schedules to:

- Keep the current price active through the end of the current month (with explicit phasing).
- Switch on the first of the next month to the new price combination:
  - Flat fee price (base monthly charge)
  - Overage price (usage-based, reported via Billing Meters)
- Reset the billing cycle anchor to the first of the month.

## What the script does

For each legacy price ID configured in the script:

1. Finds all subscriptions currently on that legacy price.
2. Ensures the subscription has a fresh schedule:
   - If a schedule exists, it is released first to avoid conflicting phases
   - A new schedule is created from the subscription
3. Configures two phases on the schedule:
   - Phase A: from now to the end of the current month
     - Keeps the existing price (no change for the remainder of the month)
     - Uses `proration_behavior: create_prorations` so extending to month end is properly accounted
   - Phase B: starts at the first of next month
     - Replaces items with the new price pair: `flatFee` and `overageFee`
     - Uses `billing_cycle_anchor: 'phase_start'` to anchor billing on the 1st

## Safety considerations

- Proration: During Phase A, prorations are created to cover any extension to the end of the month. During Phase B, no proration is applied.
- Idempotency: The script releases any existing schedule and creates a new one before applying changes — this makes re-runs predictable.

## Prerequisites

- Node.js 18+
- A Stripe API key with permissions to manage subscriptions and schedules
- Correct mapping of legacy price IDs to new `flatFee` and `overageFee` price IDs in `index.js`
- Environment file at `billing/scripts/schedule-stripe-migration/.env.local` with:

```bash
STRIPE_API_KEY=sk_live_or_test_...
```

## How to run

Run the script (from repository root):

```bash
cd billing/scripts/schedule-stripe-migration
node index.js
```

## Configuration

- Legacy price IDs (the old single-price SKUs):
  - `STARTER_PRICE_ID`, `LITE_PRICE_ID`, `BUSINESS_PRICE_ID`
- Mapping to new prices:
  - `oldToNewPrices[<OLD_PRICE_ID>] = { flatFee: '<NEW_PRICE_ID>', overageFee: '<NEW_PRICE_ID>' }`
- Billing anchor:
  - Phase B starts at the first of next month; the script computes this with `startOfMonth(new Date())` and sets `billing_cycle_anchor: 'phase_start'`.
