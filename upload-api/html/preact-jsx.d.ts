declare global {
  declare module 'preact' {
    namespace JSX {
      interface IntrinsicElements {
        /**
         * Stripe embedded pricing table
         * @see https://docs.stripe.com/no-code/pricing-table
         */
        'stripe-pricing-table': {
          'pricing-table-id': string
          'publishable-key': string

          /** @see https://docs.stripe.com/no-code/pricing-table#handle-fulfillment-with-the-stripe-api */
          'client-reference-id'?: string

          /** @see https://docs.stripe.com/no-code/pricing-table#customer-session */
          'customer-session-client-secret'?: string

          /** @see https://docs.stripe.com/no-code/pricing-table#customer-email */
          'customer-email'?: string
        }
      }
    }
  }
}
