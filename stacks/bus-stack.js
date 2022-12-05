import {
  EventBus
} from '@serverless-stack/resources'
import { setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function BusStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'bus'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  const eventBus = new EventBus(stack, 'event-bus')

  return {
    eventBus
  }
}