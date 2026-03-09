# Billing Tests

Testing guidance for the billing module using **entail** test framework.

---

## Test Framework

Uses **entail** (not ava) with a two-file pattern:

1. **Spec file** (`lib.<module>.spec.js`) - binds test context to implementation
2. **Implementation file** (`lib/<module>.js`) - contains test logic

**Critical**: Always run `.spec.js` files. Implementation files lack context binding and will fail.

**Example structure**:
- Spec: @billing/test/lib.space-billing-queue.spec.js
- Implementation: @billing/test/lib/space-billing-queue.js
- Context types: @billing/test/lib/api.ts
- Context factories: @billing/test/helpers/context.js

---

## Running Tests

Requires Docker Desktop running with dummy AWS credentials:

```bash
export AWS_REGION='us-west-2' AWS_ACCESS_KEY_ID='NOSUCH' AWS_SECRET_ACCESS_KEY='NOSUCH'

pnpm test                                                      # All billing tests
pnpm run test-only -- 'test/lib.*.spec.js'                   # All specs
pnpm run test-only -- 'test/lib.space-billing-queue.spec.js' # Storage billing
pnpm run test-only -- 'test/lib.egress-traffic.spec.js'      # Egress billing
```

---

## Test Infrastructure

Uses Docker containers via **testcontainers**:
- DynamoDB: `amazon/dynamodb-local:latest` (port 8000)
- SQS: `softwaremill/elasticmq-native` (port 9324)

Container setup: @billing/test/helpers/aws.js (`createDynamoDB()`, `createSQS()`)

---

## Test Structure

**Pattern**: Tests are flat objects with descriptive string keys (no `describe`/`it` blocks).

See examples:
- @billing/test/lib/space-billing-queue.js - Storage billing tests
- @billing/test/lib/egress-traffic.js - Egress billing tests
- @billing/test/lib/billing-cron.js - Cron trigger tests

**Test helpers** (@billing/test/helpers/):
- `randomCustomer()` - Generate test customer with Stripe account
- `randomConsumer()` - Generate test space/provider/subscription
- `randomLink()`, `randomDID()`, `randomDIDMailto()` - Generate test identifiers
- `collectQueueMessages(queue)` - Drain SQS queue for verification

**Assertions**: Entail's `assert` object provides `ok()`, `equal()`, `deepEqual()`, `fail()`.

---

## Adding New Tests

Follow existing patterns in @billing/test/:

1. **Define context type**: @billing/test/lib/api.ts (TypeScript interface)
2. **Create context factory**: @billing/test/helpers/context.js (returns stores + infrastructure)
3. **Write test implementation**: @billing/test/lib/<module>.js (flat object with test functions)
4. **Create spec file**: @billing/test/lib.<module>.spec.js (binds context to tests)
5. **Run**: `pnpm run test-only -- 'test/lib.<module>.spec.js'`

**Reference examples**:
- Simple module: @billing/test/lib/billing-cron.js
- Complex module: @billing/test/lib/space-billing-queue.js
- Stripe integration: @billing/test/lib/egress-traffic.js

---

## Test Coverage

| Component | Unit Tests | Script Simulation |
|-----------|:----------:|:----------:|
| Billing cron trigger | ✅ | ✅ |
| Customer queue processing | ✅ | ✅ |
| Space queue processing | ✅ | ✅ |
| Usage calculations (byte·ms) | ✅ | ✅ |
| Snapshot management | ✅ | ✅ |
| Month boundaries | ✅ | ✅ |
| Cumulative state progression | ✅ | ✅ |
| Egress event processing | ✅ | ❌ |
| Egress monthly aggregation | ✅ | ❌ |
| Stripe meter events (egress) | ✅ | ❌ |
| **Stripe meter events (storage)** | ❌ | ❌ |
| **DynamoDB stream → Stripe** | ❌ | ❌ |

---

## Key Testing Principles

1. Always run `.spec.js` files (implementation files fail without context)
2. Use test helpers for data generation (never manually construct test data)
3. Follow Setup → Execute → Assert pattern
4. Test edge cases: empty spaces, month boundaries, missing snapshots, snapshot fallback
5. Verify idempotency for all queue handlers
6. Use descriptive test names explaining what's being tested
7. Keep tests independent (no shared state between tests)
