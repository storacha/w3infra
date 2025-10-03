# Billing Process Overview

![](https://bafybeidagb3uf7knoogoenbtdgez7otyjxpkjbselofywfa4sdegednyfi.ipfs.w3s.link/billing.png)


1. **Real-time Space Tracking**: Increases and decreases to space size (in bytes) are recorded in the `space-diff` store in real time.
   * A consumer for the UCAN stream inserts records based on `store/add` and `store/remove` invocations. 
   * After each (`blob/accept`) and `blob/remove` is accepted by the storage node we register this blob addition or removal into the blog register table. We also insert space usage deltas directly to `space-diff` from the BlobRegistry at the point where items are added or removed.
   * Each diff record contains: `provider`, `space`, `subscription`, `cause`, `delta` (bytes), `receiptAt`, `insertedAt`

2. **Monthly Billing Trigger**: Every month on the 2nd at midnight UTC, a cron job triggers the billing process.
   * Lambda lists ALL customers from the `customer` store
   * Only customers with a valid `account` (Stripe account) are processed
   * Customer billing instructions are added to the `customer-billing-queue` with:
     - `customer` (DID)
     - `account` (Stripe account ID) 
     - `product` (billing plan)
     - `from`/`to` dates (billing period)

3. **Customer-to-Space Expansion**: A lambda consuming `customer-billing-queue` expands customers into spaces.
   * For each customer, looks up their subscriptions in `subscription` store
   * For each subscription, finds the corresponding consumer/space in `consumer` store
   * Creates space billing instructions added to `space-billing-queue` with:
     - All customer billing info plus `provider` and `space`

4. **Usage Calculation**: A lambda consuming `space-billing-queue` computes usage per space for the billing period.
   
   **Initial State:**
   * Retrieves space snapshot from `space-snapshot` store for the `from` date. This determines the total size of a space (in bytes) at the end of the _previous_ period.
   * If no snapshot exists, assumes space was empty (size = 0 bytes)
   
   **Usage Calculation:**
   * Base usage = initial_size × period_duration_ms (byte-milliseconds)
   * Lists all space diffs for the billing period from `space-diff` store
   * For each diff in chronological order:
     - Updates running size: `size += diff.delta`
     - Adds usage: `usage += size × time_since_last_change` (time_since_last_change = to - diff.receiptAt)
   
   **Storage:**
   * Records final space size in `space-snapshot` store with `recordedAt = to`
   * Records total usage in `usage` store (in byte-milliseconds)

5. **Stripe Integration**: A lambda triggered by `usage` store puts sends usage to Stripe for invoicing.
   * Converts usage to appropriate billing units (GiB)
   * Reports to Stripe billing meters for customer invoicing

## Key Details

- **Usage Units**: Calculated in byte-milliseconds, then converted to GiB/month for reporting
- **Error Handling**: Customers without Stripe accounts are skipped, failed items go to dead letter queues
- **Billing Period**: Typically from start of previous month to start of current month
- **Schedule**: Runs on the 2nd of each month