import {
  EventBus
} from '@serverless-stack/resources'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function BusStack({ stack }) {
  stack.setDefaultFunctionProps({
    srcPath: 'bus'
  })

  const eventBus = new EventBus(stack, 'event-bus')

  return {
    eventBus
  }
}