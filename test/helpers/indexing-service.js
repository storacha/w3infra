import { Client } from '@storacha/indexing-service-client'
import * as DID from '@ipld/dag-ucan/did'
import { mustGetEnv } from '../../lib/env.js'

export const serviceURL = new URL(mustGetEnv('INDEXING_SERVICE_URL'))
export const principal = DID.parse(mustGetEnv('INDEXING_SERVICE_DID'))
export const client = new Client({ serviceURL })
