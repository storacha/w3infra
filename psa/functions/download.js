import { ApiHandler } from 'sst/node/api'
import * as Link from 'multiformats/link'
import { getDownloadURL, NotFound } from '../lib.js'
import * as Config from '../config.js'
import { errorResponse, okResponse } from '../util.js'

export const handler = ApiHandler(async event => {
  const { searchParams } = new URL(`http://localhost/?${event.rawQueryString}`)

  let root
  try {
    root = Link.parse(searchParams.get('root') ?? '')
  } catch {
    return errorResponse('Invalid "root" search parameter', 400)
  }

  try {
    const url = await getDownloadURL(Config.buckets, root)
    return okResponse({ root, url })
  } catch (/** @type {any} */ err) {
    if (!(err instanceof NotFound)) console.error(err)
    return errorResponse(err.message, err instanceof NotFound ? 404 : 500)
  }
})
