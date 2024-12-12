# Space Allocations Snapshot

This script calculates the current storage billing amounts by directly referencing the store and blob allocations tables, bypassing the reliance on receipts. While the current system uses receipts to track transient activity over a billing cycle, this approach can introduce errors that compound over time, leading to incorrect billing for users.

### Purpose

- Run this calculation on demand, ideally before each billing cycle, to restore accurate billing amounts immediately.
- Use it to monitor system accuracy over time, continue periodic cross-checking until issues in the billing system are fully resolved.

### Usage

Create your own `.env.local` file and fill in the relevant details:

```sh
cp billing/scripts/space-allocations-snapshot/.env.template billing/scripts/space-allocations-snapshot/.env.local
```

You can run the allocation snapshot pipeline with the following optional arguments:

- `from=yyyy-mm-dd`: Start date for the snapshot. Defaults to the Unix epoch (1970-01-01) if not provided.
- `to=yyyy-mm-dd`: End date for the snapshot. Defaults to the first day of the next month if not provided.
- `customer=did:mailto:agent`: DID of the user account. Defaults to get all customers.

**Example Command:**

```sh
cd billing/scripts/space-allocations-snapshot
node index.js from=2024-11-01 to=2024-12-01
```
