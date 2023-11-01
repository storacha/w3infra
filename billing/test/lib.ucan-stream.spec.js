import * as UCANStream from './lib/ucan-stream.js'
import { bindTestContext, createUCANStreamTestContext } from './helpers/context.js'

export const test = bindTestContext(UCANStream.test, createUCANStreamTestContext)
