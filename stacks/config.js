// TREAT THIS THE SAME AS AN ENV FILE
// DO NOT INCLUDE SECRETS IN IT
import { RemovalPolicy } from 'aws-cdk-lib'

const stageConfigs = {
  dev: {
    bucketConfig: {
      cdk: {
        bucket: {
          autoDeleteObjects: true,
          removalPolicy: RemovalPolicy.DESTROY,
        },
      },
    },
    tableConfig: {
      cdk: {
        table: {
          removalPolicy: RemovalPolicy.DESTROY,
        },
      },
    },
  },
  staging: {
    bucketConfig: {
      cdk: {
        bucket: {
          // Force name of bucket to be "carpark-staging-0" in staging.
          bucketName: 'carpark-staging-0'
        },
      },
    },
  },
  prod: {
    bucketConfig: {
      cdk: {
        bucket: {
          // Force name of bucket to be "carpark-prod-0" in prod.
          bucketName: 'carpark-prod-0'
        },
      },
    },
  },
}

/**
 * @param {'dev'|'staging'|'prod'} stage
 * @returns {{ bucketConfig ?:any, tableConfig ?:any }}
 */
export function getConfig(stage) {
  return stageConfigs[stage] || stageConfigs.dev
}

/**
 * Return the custom domain config for http api
 * 
 * @param {string} stage
 * @param {string | undefined} hostedZone
 * @returns {{domainName: string, hostedZone: string} | undefined}
 */
export function getCustomDomain (stage, hostedZone) {
  // return no custom domain config if hostedZone not set
  if (!hostedZone) {
    return 
  }
  /** @type Record<string,string> */
  const domainMap = { prod: hostedZone }
  const domainName = domainMap[stage] ?? `${stage}.${hostedZone}`
  return { domainName, hostedZone }
}
