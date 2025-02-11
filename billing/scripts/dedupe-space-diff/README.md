# Dedup Space Diff Table

A bug that caused duplicate entries in the `space-diff` table has been identified and fixed. To ensure the table reflects the correct state, it is essential that only one item with a specific `cause` exists. This requires identifying the duplicates and removing the most recently inserted one.

To accomplish this, AWS Glue was used. Below are the steps that were executed to resolve the issue:

1. **Get the data:** Export the table data to S3.
2. **Identify the Duplicates:** run the `dedupe-space-diff job` on AWS Glue.
3. **Remove the Dyplicates:** run the `delete-from-dynamo` job on AWS Glue.

<small><small>**Note:** Since this was a one-time task, the Glue jobs were not added to our stack. However, here are the scripts in case it's needed to run them again, along with a simple deployment script.</small></small>
