# Billing

![](https://bafybeidagb3uf7knoogoenbtdgez7otyjxpkjbselofywfa4sdegednyfi.ipfs.w3s.link/billing.png)

1. Increases and decreases to space size (in bytes) are recorded in the `space-diff` store (in real time).
    * A consumer for the UCAN stream inserts records based on `store/add` and `store/remove` invocations.
1. Every month, a lambda invoked by cron lists ALL records from the `customer` store and adds them to the `customer-billing-queue` queue (along with a to/from date, which specifies the period the billing cycle is being run from).
    * Records are added to `customer` when we receive a webhook from Stripe after a customer chooses a plan and adds their credit card details.
1. A lambda consuming the `customer-billing-queue`, expands the list of customers into a list of spaces (with corresponding customer information).
    * The list of spaces is added to the `space-billing-queue` queue.
1. A lambda consuming the `space-billing-queue` computes the usage per space for the period.
    * It uses the `space-snapshot` store to determine the total size of a space (in bytes) at the end of the _previous_ period.
    * It lists records in the `space-diff` store for the billing period.
    * The new total size of the space at the end of the period is recorded in the `space-snapshot` store.
    * Usage for the period is calculated and added to the `usage` store.
1. A lambda invoked after a put event to the `usage` store sends usage information to Stripe.
