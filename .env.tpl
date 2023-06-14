# These variables are only available in your SST code.

# uncomment to try out deploying the w3up api under a custom domain.
# the value should match a hosted zone configured in route53 that your aws account has access to.
# HOSTED_ZONE=up.dag.haus

# uncomment to try out deploying the roundabout api under a custom domain.
# the value should match a hosted zone configured in route53 that your aws account has access to.
# ROUNDABOUT_HOSTED_ZONE=roundabout.web3.storage

# uncomment to set SENTRY_DSN
# SENTRY_DSN = ''

EIPFS_INDEXER_SQS_ARN = 'arn:aws:sqs:us-west-2:505595374361:staging-ep-indexer-topic'
EIPFS_INDEXER_SQS_URL = 'https://sqs.us-west-2.amazonaws.com/505595374361/staging-ep-indexer-topic'

# Following variables are only required to run integration tests
INTEGRATION_TESTS_UCAN_KEY = ''
INTEGRATION_TESTS_PROOF = ''

ACCESS_SERVICE_DID = ''
UPLOAD_API_DID = ''
ACCESS_SERVICE_URL = ''
R2_ACCESS_KEY_ID = ''
R2_CARPARK_BUCKET_NAME = ''
R2_DUDEWHERE_BUCKET_NAME = ''
R2_ENDPOINT = ''
R2_REGION = ''
R2_SATNAV_BUCKET_NAME = ''
R2_SECRET_ACCESS_KEY = ''
R2_UCAN_BUCKET_NAME = ''
SATNAV_BUCKET_NAME = ''
