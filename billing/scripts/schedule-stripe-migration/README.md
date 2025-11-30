# Stripe Subscription Migration Script

This script updates customer subscriptions from the legacy single-price plans to the new split pricing model (flat monthly fee + usage overage price + egress overage price) as part of the billing migration to Stripe Billing Meters.

It uses Subscription Schedules to:

- Keep the current price active through the end of the current month (with explicit phasing).
- Switch on the first of the next month to the new price combination:
  - Flat fee price (base monthly charge)
  - Usage Overage price (usage-based, reported via usage Billing Meters)
  - Egress Overage price (usage-based, reported via egress Billing Meters)
- Reset the billing cycle anchor to the first of the month.

## What the script does

For each legacy price ID configured in the script:

1. Finds all subscriptions currently on that legacy price.
2. Ensures the subscription has a fresh schedule:
   - If a schedule exists, it is released first to avoid conflicting phases
   - A new schedule is created from the subscription
3. Configures two or three phases on the schedule:
   - Phase 1: from now to the end of the current month
     - Keeps the existing price (no change for the remainder of the month)
     - Manually calculates proration so extending or shortening the current billing cycle is properly accounted for
   - Phase 1.5: if we need to extend the customer’s billing cycle, there's an extra phase to account for that.
   - Phase 2: starts at the first of next month
     - Replaces items with the new prices: `flatFee`, `overageFee`, `egressFee`
     - Uses `billing_cycle_anchor: 'phase_start'` to anchor billing on the 1st
4. Updates the product name in dynamo to the new one

## Safety considerations

- Proration: During Phase 1, prorations are created to cover any extension or shortening of the current billing cycle to the end of the month. During Phase 2, no proration is applied.
- Idempotency: The script releases any existing schedule and creates a new one before applying changes — this makes re-runs predictable.

## Prerequisites

- Node.js 18+
- A Stripe API key with permissions to manage subscriptions and schedules
- Correct mapping of legacy price IDs to new `flatFee` and `overageFee` price IDs in `prices-config.js`
- Environment file at `billing/scripts/schedule-stripe-migration/.env.local` with:

```bash
AWS_REGION='us-west-2'
STORACHA_ENV='staging'
STRIPE_API_KEY=sk_live_or_test_...
```

## How to run

Run the script (from repository root):

```bash
cd billing/scripts/schedule-stripe-migration
node index.js 
```

### Script Arguments

- `--priceId=<PRICE_ID>`: Limits processing to subscriptions associated with the specified legacy price ID.
- `--lastId=<SUBSCRIPTION_ID>`: Resumes processing from the given subscription ID. Use in combination with `--priceId` for partial or interrupted runs.

## Configuration

- Billing anchor:
  - Phase 2 starts at the first of next month; the script computes this with `startOfMonth(new Date())` and sets `billing_cycle_anchor: 'phase_start'`.
