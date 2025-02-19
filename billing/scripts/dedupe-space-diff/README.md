# Dedup Space Diff Table

A bug that caused duplicate entries in the `space-diff` table has been identified and fixed. To ensure the table reflects the correct state, it is essential that only one item with a specific `cause` exists. This requires identifying the duplicates and removing the most recently inserted one.

The process consists of two steps:

1. Identifying duplicates using AWS Glue
2. Deleting duplicate entries using a script

## 1. Duplicates identification

1. **Get the data:** Export the table data to S3.
2. **Identify the Duplicates:** run the `dedupe-space-diff job` on AWS Glue.

<small><small>**Note:** Since this was a one-time task, the Glue jobs were not added to our stack. However, here are the scripts in case it's needed to run them again, along with a simple deployment script.</small></small>

## 2. Delete the Duplicates

To delete the duplicates, first, download the output files from the previous step. These files contain the partition and sort keys of the duplicate items that need to be deleted.

To download the files, run:

```sh
cd billing/scripts/space-allocations-snapshot
node download-s3-files.js prod-w3infra-space-diff-export/dedupe_output dedupe_output
```

Arguments:

- `bucketName/folderPath`: The S3 location of the files.
- `localFolderPath`: The local directory where the files should be downloaded.

Once the files are downloaded, delete the duplicates by running:

```sh
cd billing/scripts/space-allocations-snapshot
node remove-duplicates.js dedupe_output
```

Arguments:

- `localFolderPath`: The local directory containing the downloaded files.

## Learnings from This Task

Using AWS Glue to identify duplicates was a great decision. Leveraging PySpark’s power, we efficiently processed large datasets and quickly identified duplicates with minimal effort. However, while Glue was highly effective for detection, it turned out to be less ideal for deletion.

Initially, we assumed Glue would also be a good fit for deleting records from DynamoDB. However, due to DynamoDB's batch write limitation of 25 items per request, we had to process over 200,000 batches. This required constantly loading items into the worker’s memory, significantly slowing down the operation. This overhead made the deletion process inefficient compared to a simpler approach using a direct AWS SDK script.
