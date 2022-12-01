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

  // Setup Sentry when not in local
  if (!app.local) {
    setupSentry(stack)
  }

  const eventBus = new EventBus(stack, 'event-bus')

  return {
    eventBus
  }
}