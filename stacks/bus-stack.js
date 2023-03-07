import {
  EventBus
} from 'sst/constructs'
import { setupSentry } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function BusStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  const eventBus = new EventBus(stack, 'event-bus')

  return {
    eventBus
  }
}