# These variables are only available in your SST code.

# uncomment to try out deploying the w3up api under a custom domain (or more
# than one). the value should match a hosted zone configured in route53 that
# your aws account has access to.
# HOSTED_ZONES=up.storacha.network,up.web3.storage

# uncomment to try out deploying the roundabout api under a custom domain.
# the value should match a hosted zone configured in route53 that your aws account has access to.
# ROUNDABOUT_HOSTED_ZONE=roundabout.web3.storage

# uncomment to disable the roundabout stack deployment and instead use an
# existing roundabout deployment. This is primarily for use by other deployed
# upload services that all use the same Filecoin pipeline.
# ROUNDABOUT_API_URL = 'https://roundabout.web3.storage'

# uncomment to set SENTRY_DSN
# SENTRY_DSN = ''

EIPFS_INDEXER_SQS_ARN = 'arn:aws:sqs:us-west-2:505595374361:staging-ep-indexer-topic'
EIPFS_INDEXER_SQS_URL = 'https://sqs.us-west-2.amazonaws.com/505595374361/staging-ep-indexer-topic'
EIPFS_MULTIHASHES_SQS_ARN = 'arn:aws:sqs:us-west-2:505595374361:staging-ep-multihashes-topic'

PROVIDERS = ''
UPLOAD_API_DID = ''
UPLOAD_API_ALIAS = ''
ACCESS_SERVICE_URL = ''
AGGREGATOR_DID = ''
AGGREGATOR_URL = ''
DEAL_TRACKER_DID = ''
DEAL_TRACKER_URL = ''
UCAN_INVOCATION_POST_BASIC_AUTH =''

INDEXING_SERVICE_DID = ''
INDEXING_SERVICE_URL = ''

POSTMARK_TOKEN = ''
R2_ACCESS_KEY_ID = ''
R2_CARPARK_BUCKET_NAME = ''
R2_ENDPOINT = ''
R2_REGION = ''
R2_SECRET_ACCESS_KEY = ''
R2_DELEGATION_BUCKET_NAME = ''

# Following variables are only required to run integration tests

# Mailslurp
MAILSLURP_API_KEY = ''
MAILSLURP_TIMEOUT = '120000'

# Stripe
# these values are from the Stripe test environment
STRIPE_PRICING_TABLE_ID = 'prctbl_1NzhdvF6A5ufQX5vKNZuRhie'
STRIPE_FREE_TRIAL_PRICING_TABLE_ID = 'prctbl_1QHa8sF6A5ufQX5vJ8SUZUjq'
STRIPE_PUBLISHABLE_KEY = 'pk_test_51LO87hF6A5ufQX5viNsPTbuErzfavdrEFoBuaJJPfoIhzQXdOUdefwL70YewaXA32ZrSRbK4U4fqebC7SVtyeNcz00qmgNgueC'
# this is used in tests and should always be set to the test env secret key
STRIPE_TEST_SECRET_KEY = ''
STRIPE_BILLING_METER_ID = ''
STRIPE_BILLING_METER_EVENT_NAME = ''

# Feature flags
REQUIRE_PAYMENT_PLAN = 'true'

# Referrals
REFERRALS_ENDPOINT = 'https://staging.referrals.storacha.network'

# GitHub OAuth (optional)
GITHUB_CLIENT_ID = ''
GITHUB_CLIENT_SECRET = ''

# Optional - custom principal resolution mappings
# JSON encoded mapping of did:web to did:key
PRINCIPAL_MAPPING = '{"did:web:example.com":"did:key:z6MktkCXwNmpqejQxYd7JHPcw7d4Srjct7sX74VLfKqsPyAw"}'

# Optional - custom storage provider to use in integration tests
INTEGRATION_TESTS_STORAGE_PROVIDER_DID = ''
INTEGRATION_TESTS_STORAGE_PROVIDER_ENDPOINT = ''
INTEGRATION_TESTS_STORAGE_PROVIDER_PROOF = ''

# Optional - custom gateway to authorize in integration tests (defaults to staging)
INTEGRATION_TESTS_GATEWAY_DID = ''
INTEGRATION_TESTS_GATEWAY_ENDPOINT = ''

HUMANODE_TOKEN_ENDPOINT='https://auth.demo-storacha-2025-03-31.oauth2.humanode.io/oauth2/token'
HUMANODE_CLIENT_ID='e9756297-b2d1-4bbe-a139-a9ad1cdc43ee'
