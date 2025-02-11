import sys
import math
import time
import boto3
from awsglue.transforms import *
from pyspark.sql.functions import row_number,lit
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from pyspark.sql.window import Window
from awsglue.job import Job

## @params: [JOB_NAME]
args = getResolvedOptions(sys.argv, ['JOB_NAME', 'S3_INPUT_PATH', 'DYNAMODB_TABLE_NAME', 'AWS_REGION', 'S3_FAILED_ITEMS_PATH'])

# Initialize Glue context
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Initialize job context
batch_size = 25
region = args['AWS_REGION']
input_path = args['S3_INPUT_PATH']
table_name = args['DYNAMODB_TABLE_NAME']
failed_items_path = args['S3_FAILED_ITEMS_PATH']
logger = glueContext.get_logger()

# Initialize DynamoDB client
dynamodb = boto3.client('dynamodb', region_name=region)

def write_failed_items_to_s3(failed_items, s3_path):
    if not failed_items: # extra check
      return  

    failed_df = spark.createDataFrame(failed_items)
    output_path = f"{s3_path}/failed_deletions_{int(time.time())}"

    # Write to S3 as JSON
    failed_df.write.mode("overwrite").json(output_path)
    logger.info(f"Failed deletions written to {output_path}")
    

def batch_delete_with_retries(request_items, max_retries=5):
    for attempt in range(max_retries):
        # Perform batch delete
        response = dynamodb.batch_write_item(RequestItems=request_items)
        
        # Check for unprocessed items
        unprocessed_items = response['UnprocessedItems']
        
        if not unprocessed_items:
            return [] # Success, exit function

        logger.warning(f"Retry {attempt + 1}/{max_retries}: {len(unprocessed_items)} unprocessed items")
        time.sleep(0.100 * (2 ** attempt))  # Exponential backoff
        
        # Retry only the unprocessed items
        request_items = unprocessed_items

    logger.error(f"Failed to delete {len(request_items)} items after {max_retries} retries.")
    return request_items[table_name]
    

df = spark.read.parquet(input_path)
total_records = df.count()
total_batches = math.ceil(total_records / batch_size)

logger.info(f"total records: {total_records}")
logger.info(f"total batches: {total_batches}")

batch_num = 0
current_batch = []
all_failed_items = [] 

def processBatch(batch_num, current_batch):
  if not current_batch:
    return
  
  request_items = {
    table_name: [
        {
            "DeleteRequest": {
                "Key": {
                    "pk": {"S": item["pk"]},
                    "sk": {"S": item["sk"]}
                }
            }
        } for item in current_batch
    ]
  }
  failed_items = batch_delete_with_retries(request_items)
  all_failed_items.extend(failed_items)


# Adding the ids to the df 
w = Window().orderBy(lit('A'))
df_with_index = df.withColumn('id', row_number().over(w))

# Iterating into chunks
logger.info(f"Processing data into chuncks of {batch_size}...")
for page_num in range(0, total_records, batch_size):
  initial_page = page_num
  final_page = initial_page + batch_size 
  where_query = ('id > {0} and id <= {1}').format(initial_page,final_page)
  logger.info(where_query)
  chunk_df = df_with_index.where(where_query)
  processBatch(batch_num, chunk_df.collect())
  batch_num += 1
  percentage_done = ((batch_num) / total_batches) * 100
  logger.info(f"Processed batch {batch_num}/{total_batches} ({percentage_done:.2f}%)")


if all_failed_items:
    write_failed_items_to_s3(all_failed_items, failed_items_path)

job.commit()
logger.info("Done!")