import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql.functions import col, row_number
from pyspark.sql.window import Window
from awsglue.context import GlueContext
from awsglue.job import Job

## @params: [JOB_NAME]
args = getResolvedOptions(sys.argv, ['JOB_NAME', 'S3_INPUT_PATH', 'S3_OUTPUT_PATH'])

# Initialize Glue context
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)


input_path = args['S3_INPUT_PATH']
output_path = args['S3_OUTPUT_PATH']

# Read gzipped JSON file
df = spark.read.json(input_path)

# Flatten JSON
df_flat = df.select(
    col("Item.pk.S").alias("pk"),
    col("Item.sk.S").alias("sk"),
    col("Item.cause.S").alias("cause"),
    col("Item.receiptAt.S").alias("receiptAt")
)

# Convert receiptAt to timestamp
df_flat = df_flat.withColumn("receiptAt", col("receiptAt").cast("timestamp"))

# Define window partitioned by "cause" and ordered by "receiptAt"
window_spec = Window.partitionBy("cause").orderBy("receiptAt")

# Add a row number to identify the smallest receiptAt for each cause
df_ranked = df_flat.withColumn("row_num", row_number().over(window_spec))

# Keep only duplicate records (excluding the first occurrence per cause)
df_duplicates = df_ranked.filter(col("row_num") > 1).select("pk", "sk")

# Write the duplicates to S3
df_duplicates.write.mode("overwrite").parquet(output_path)

print(f"Duplicate records saved to {output_path}")


job.commit()