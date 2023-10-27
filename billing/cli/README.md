# Billing CLI

```sh
# env vars for config
billing customer add did:mailto:protocol.ai:test0 stripe:cus_9s6XKzkNRiz8i3 --product lite
# Added did:mailto:protocol.ai:test0

# add a space
# adds subcription, consumer, snapshot
billing space add did:mailto:protocol.ai:test0
# Space: did:key:space0
billing space add did:mailto:protocol.ai:test0
# Space: did:key:space1

# simulate adding diffs
billing diff add did:key:space0 3MB 2023-09-16T09:00:00.000Z
billing diff remove did:key:space0 3MB 2023-09-27T09:00:00.000Z

# do a billing run
billing run 2023-09-01T00:00:00.000Z 2023-10-01T00:00:00.000Z

# get usage for customer for period
billing usage did:mailto:protocol.ai:test0 2023-09-01T00:00:00.000Z 2023-10-01T00:00:00.000Z
# Customer: did:mailto:protocol.ai:test0
# Usage:
#   did:key:space0 12345 $500
#   did:key:space1 12345 $500
# Total: $1000
```
