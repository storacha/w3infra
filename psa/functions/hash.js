import { ApiHandler } from 'sst/node/api'
import * as Link from 'multiformats/link'
import { getHash, NotFound } from '../lib.js'
import * as Config from '../config.js'
import { okResponse, errorResponse } from '../util.js'

export const handler = ApiHandler(async event => {
  const { searchParams } = new URL(`http://localhost/?${event.rawQueryString}`)

  let root
  try {
    root = Link.parse(searchParams.get('root'))
  } catch (err) {
    return errorResponse('Invalid "root" search parameter', 400)
  }

  try {
    const shard = await getHash(Config.buckets, root)
    return okResponse({ root, shard })
  } catch (err) {
    return errorResponse(err.message, err instanceof NotFound ? 404 : 500)
  }
})
