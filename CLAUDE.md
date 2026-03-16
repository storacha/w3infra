# CLAUDE.md

This file provides guidance to AI agents (Claude Code, GPT, etc.) when working with code in this repository.

This repository contains the **infrastructure and backend services** for the Storacha / web3.storage upload service.

The system exposes a **UCAN-based API** for storing CAR files and registering uploads, and manages supporting infrastructure including billing, Filecoin deals, indexing, and replication.

For human-oriented documentation see `README.md`.

---

## Quick Start for Agents

Before modifying code:

1. **Identify the package**: Determine which package (`billing/`, `upload-api/`, etc.) contains the code you need to change
2. **Read package CLAUDE.md**: Check if `<package>/CLAUDE.md` exists and read it for package-specific guidance
3. **Understand existing patterns**: Read related code to understand conventions before making changes
4. **Use existing stores**: Prefer existing store abstractions (CustomerStore, UsageStore, etc.) over direct DynamoDB queries
5. **Write tests**: Add or update tests when modifying business logic

---

## Repository Structure

This is a **pnpm monorepo** containing multiple **AWS Lambda services** deployed using **SST (Serverless Stack)** and **AWS CDK**.

Each top-level directory represents a logical service or shared infrastructure.

### Packages

- **billing/** - Usage accounting, daily billing runs, Stripe integration (Lambda + DynamoDB) → See @billing/CLAUDE.md
- **upload-api/** - Core UCAN HTTP gateway API with Lambda functions
- **filecoin/** - Filecoin deal management and aggregation
- **indexer/** - E-IPFS and IPNI (InterPlanetary Network Indexer) connectivity
- **roundabout/** - Piece CID to signed URL redirection service
- **carpark/** - CAR announcement Lambda
- **replicator/** - Bucket replication to Cloudflare R2
- **stacks/** - SST + AWS CDK infrastructure definitions (stack files)
- **tools/** - CLI tools for admin tasks and migrations
- **services/** - Additional service configurations

**Main entrypoints:**
- `upload-api/` — the core API
- `billing/` — usage tracking and Stripe reporting
- `stacks/` — infrastructure definitions

---

## Development Commands

### Local Development

```bash
pnpm start                          # Start SST dev environment (requires AWS account)
pnpm run check                      # TypeScript type checking
pnpm run lint                       # Run tsc && eslint
pnpm run lint:fix                   # Auto-fix lint issues
```

### Testing

Requires Docker Desktop running + AWS env vars (can be dummy values):

```bash
export AWS_REGION='us-west-2' AWS_ACCESS_KEY_ID='NOSUCH' AWS_SECRET_ACCESS_KEY='NOSUCH'

pnpm test                           # Run all package tests
pnpm test -w billing                # Run billing package tests (uses entail)
pnpm test -w upload-api             # Run upload-api tests (uses ava)

# Run single test file:
pnpm run test-only -w billing -- 'lib/*.spec.js'        # Single billing test
pnpm test -w upload-api -- test/helpers/blob.test.js    # Single upload-api test
```

---

## Architecture

### Technology Stack

- **Runtime**: Node.js >= 16 locally, Node.js 20.x (arm_64) in Lambda
- **Framework**: SST 2.x with AWS CDK
- **Database**: DynamoDB (with streams for event-driven processing)
- **Queues**: SQS with Dead Letter Queues (DLQs)
- **Payments**: Stripe (billing meters v2025-02-24.acacia)
- **Auth**: UCAN (User Controlled Authorization Network) via Ucanto
- **Web3**: IPFS (Helia), IPLD, Filecoin, IPNI

### Lambda Architecture Pattern

Most services follow this layered architecture:

```
Lambda Handler (functions/*.js)
    ↓
Business Logic (lib/*.js)
    ↓
Store Abstraction (lib/store/*.js)
    ↓
DynamoDB / External Service
```

**Example**: `@billing/functions/usage-table.js` (handler) → `@billing/lib/space-billing-queue.js` (logic) → `@billing/lib/store/usage.js` (store)

**Key principles:**
- Handlers are thin wrappers that parse events and handle responses
- Stores encapsulate all database/external service interactions
- All Lambda handlers should be idempotent

### Environment Variables & Configuration

Lambda env vars are subject to a **4KB size limit**. To work around this, the codebase uses a **3-layer config pattern** instead of setting env vars directly on Lambdas:

1. **Deploy time** (@stacks/upload-db-stack.js): reads `process.env.*` from the CI/deploy environment and writes values into AWS SSM Parameter Store via `new Config.Parameter(stack, 'NAME', { value: process.env.NAME })`. The deploy-time env var name and the SSM parameter name may differ (e.g. `STRIPE_DEFAULT_SUCCESS_URL` → `STRIPE_SUCCESS_URL`).

2. **Lambda cold start** (@upload-api/functions/ucan-invocation-router.js): the `SSM_PARAMETERS` array lists which SSM params to load, and `loadSSMParameters()` (from @lib/ssm.js) fetches them all into an in-process cache.

3. **Runtime** (`getLambdaEnv()` in @upload-api/functions/ucan-invocation-router.js): values are read from the SSM cache via `getSSMParameter()` (optional, returns `''`) or `mustGetSSMParameter()` (throws if missing) — **never** via `process.env` directly for these params.

**Where to set values:**
- **Local development**: `.env.local` (gitignored copy of `.env.tpl`)
- **Staging / Production**: seed.run console → app → stage → Settings → Environment Variables

**Adding a new config parameter:**
1. Add `if (process.env.MY_VAR) { new Config.Parameter(stack, 'MY_PARAM', { value: process.env.MY_VAR }) }` in @stacks/upload-db-stack.js
2. Add `'MY_PARAM'` to the `SSM_PARAMETERS` array in @upload-api/functions/ucan-invocation-router.js
3. Read it in `getLambdaEnv()` via `getSSMParameter('MY_PARAM')` and return it
4. Pass it explicitly to any function that needs it — **do not read `process.env.MY_PARAM` inside business logic**
5. Add `MY_VAR = ''` to @.env.tpl
6. Set `MY_VAR` in seed.run for each stage

**Secrets** (sensitive values like API keys) use `Config.Secret` instead of `Config.Parameter` and are bound to Lambdas via the `bind:` array. They are defined in @stacks/upload-db-stack.js and accessed via `Config.MY_SECRET` at runtime (SST handles the SSM lookup automatically).

---

### Code Style

- ESM modules with TypeScript type checking via JSDoc annotations
- Prettier: single quotes, no semicolons, trailing commas (es5)
- Pre-commit hooks run lint-staged with eslint --fix
- Test frameworks: `entail` for billing, `ava` for upload-api and integration tests

---

## Common Tasks

### Adding a new API capability
→ Modify `upload-api/`

### Adding or modifying billing logic
→ Modify `billing/` (read @billing/CLAUDE.md first)

### Changing infrastructure (tables, queues, lambdas)
→ Modify `stacks/*.js`

### Adding a new Lambda function
1. Create handler in `<package>/functions/`
2. Add business logic in `<package>/lib/`
3. Define infrastructure in `stacks/`
4. Add tests in `<package>/test/`

---

## Deployment & Environments

- **CI/CD**: seed.run manages deployments
- **main branch** → staging at `https://staging.up.storacha.network`
- **PR builds** → temporary infra at `https://<pr#>.up.storacha.network`
- **Production** promotions are manual via seed.run console

---

## Working With Packages

Many packages contain their own **CLAUDE.md** file with detailed, package-specific instructions.

**When modifying code inside a package:**

1. **Check for `<package>/CLAUDE.md`** and read it
2. Follow the local conventions described there
3. Understand the package's architecture before making changes
4. Avoid cross-package coupling unless necessary

**Packages with dedicated CLAUDE.md:**
- @billing/CLAUDE.md - Billing system architecture, usage calculations, Stripe integration

---

## Important Guidelines for AI Agents

When modifying this repository:

1. **Read package-specific CLAUDE.md** if it exists before making changes
2. **Prefer existing stores and utilities** over direct DynamoDB queries
3. **Maintain idempotency** for all Lambda handlers (they may be retried)
4. **Follow existing patterns** in the package you're modifying
5. **Write tests** when adding or modifying business logic (especially billing and upload-api)
6. **Update infrastructure in `stacks/`** when adding tables, queues, or lambdas
7. **Avoid cross-package dependencies** unless architecturally necessary
8. **Use TypeScript via JSDoc** for type safety without compilation overhead
9. **Check DLQ configurations** when adding SQS-triggered lambdas
10. **Consider billing implications** when modifying storage or data flows

---

## Getting Help

- **Package-specific questions**: Read @<package>/CLAUDE.md
- **Billing architecture**: Read @billing/CLAUDE.md and @docs/storage-billing.md
- **Infrastructure patterns**: Examine existing stacks in @stacks/
- **Script patterns**: Read examples in @billing/scripts/ or @tools/
