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

Run the allocation snapshot pipeline:

```sh
cd billing/scripts/space-allocations-snapshot
node index.js
```
