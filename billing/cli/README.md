# Billing CLI

```sh
# env vars for config
billing customer add did:mailto:protocol.ai:alan stripe:cus_9s6XKzkNRiz8i3
# Added did:mailto:protocol.ai:alan

# add a space
# adds subcription, consumer, snapshot
billing space add did:mailto:protocol.ai:alan
# Space: did:key:space0
billing space add did:mailto:protocol.ai:alan
# Space: did:key:space1

# simulate adding diffs
billing diff add did:key:space0 3GB 2023-09-02T09:00:00.000Z
billing diff remove did:key:space0 3GB 2023-09-29T09:00:00.000Z

billing diff add did:key:space1 2GB 2023-09-15T09:00:00.000Z

# do a billing run
billing run 2023-09-01T00:00:00.000Z 2023-10-01T00:00:00.000Z

# get usage for customer for period
billing usage did:mailto:protocol.ai:alan 2023-09-01T00:00:00.000Z 2023-10-01T00:00:00.000Z
# Customer: did:mailto:protocol.ai:alan
# Usage:
#   did:key:space0 12345 $500
#   did:key:space1 12345 $500
# Total: $1000
```

## Required environment

```sh
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

STORE_TABLE_NAME=pr240-w3infra-store
CUSTOMER_TABLE_NAME=pr240-w3infra-customer
SUBSCRIPTION_TABLE_NAME=pr240-w3infra-subscription
CONSUMER_TABLE_NAME=pr240-w3infra-consumer
SPACE_DIFF_TABLE_NAME=pr240-w3infra-space-diff
SPACE_SNAPSHOT_TABLE_NAME=pr240-w3infra-space-snapshot
USAGE_TABLE_NAME=pr240-w3infra-usage

RUNNER_URL=https://xxx.lambda-url.us-east-2.on.aws/
```
