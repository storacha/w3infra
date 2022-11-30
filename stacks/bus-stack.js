import {
  EventBus
} from '@serverless-stack/resources'
import { setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function BusStack({ stack }) {
  stack.setDefaultFunctionProps({
    srcPath: 'bus'
  })

  // Setup Sentry when not in dev mode
  if (stack.stage !== 'dev') {
    setupSentry(stack)
  }

  const eventBus = new EventBus(stack, 'event-bus')

  return {
    eventBus
  }
}