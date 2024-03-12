# dry-run.js

## Usage

```sh
cd billing/scripts
node dry-run.js
```

This will output a CSV file (`summary-[from]-[to].csv`) with ordered per customer information about what they will be charged.

Much more info is collected, and is output to a JSON file `usage-[from]-[to].json` if you want to do some more spelunking.

Note: this is only as up to date as the `productInfo` found in `helpers.js` which is (at time of writing) set as:

* `did:web:starter.web3.storage` cost: $0, overage: 0.15 / GB, included: 5 * GB
* `did:web:lite.web3.storage` cost: $10, overage: 0.05 / GB, included: 100 * GB,
* `did:web:business.web3.storage` cost: $100, overage: 0.03 / GB, included: 2 * TB
