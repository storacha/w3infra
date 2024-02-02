# UCAN Invocation Stream

> UCAN invocations cause transactions that mutate the w3up platform. The history of these invocations will be an audit of the system, which we can rely on for playback operations from a given time, as well as for asynchronous computations for Telemetry, Metrics, User Facing aggregations, among others.

## Background

UCAN is a chained-capability format. A UCAN contains all of the information that one would need to perform some task, and the provable authority to do so. 

We can identify three core components on our services built relying on UCANs:
- Task to be executed (`with`, `can` and `nb` fields of UCAN)
  - Bear in mind that in UCAN world `task` was renamed to `instruction`, and `task` is used to refer to an invocation without authorization.
- Invocation (task to be executed together with the provable authority to do so `proofs` + `signature`)
- Workflow (file containing one or more invocations to be executed)

With the above components, we can say that:
- One task may have many receipts (one per invocation) all with the same result.
- We could (in theory) receive same invocation in multiple CARs

## Architecture

The entry point for the UCAN Invocation stream is an HTTP endpoint `POST /ucan`. It will receive [Agent Messages](https://github.com/web3-storage/ucanto/blob/main/packages/core/src/message.js) from other services with invocations to be executed and/or reported receipts. All invocations and their receipts are persisted in buckets and added into the UCAN Stream.

AWS Kinesis is the central piece of this architecture. Multiple stream consumers can be hooked into AWS Kinesis for post processing of UCAN invocations.

![High level Architecture](https://bafybeifub7gefocq2yqw4dbvpbon2aduw6sq4aqfaergaennhgts4d3hpa.ipfs.w3s.link/ucan-log-stream-v2.jpg)

Note that at the time of writing Event Archival flow is still to be implemented.

### Buckets

UCAN Invocation Stack contains 3 buckets so that it can keep an audit of the entire system, while allowing this information to be queried in multiple fashions.

Firstly, the **`workflow-store` bucket** stores the entire encoded agent message files containing invocations to be executed, and/or created receipts for ran invocations. It is stored as received from UCAN services interacting with UCAN Invocation Stream. It is keyed as `${agentMessageArchive.cid}/${agentMessageArchive.cid}` and its value is likely in CAR format. However, CID codec should tell if it is something else.

At the invocation level, the **`invocation-store` bucket** is responsible for storing two types of values related to UCAN invocations:
- a pseudo symlink to `/${agentMessageArchive.cid}/${agentMessageArchive.cid}` via key `${invocation.cid}/${agentMessageArchive.cid}.in` to track where each invocation lives in a agent message file. As a pseudo symlink, it is an empty object.
- a pseudo symlink to `/${agentMessageArchive.cid}/${agentMessageArchive.cid}` via key `${invocation.cid}/${agentMessageArchive.cid}.out` to track where each receipt lives in a agent message file. As a pseudo symlink, it is an empty object.

In the tasks context, the **`task-store` bucket** stores two types of values related to executed tasks:
- a pseudo symlink to `/${invocation.cid}/${invocation.cid}` via `${task.cid}/${invocation.cid}.invocation` to enable looking up invocations and receipts by a task. As a pseudo symlink, it is an empty object.
- a block containing the `out` field of the receipt. So that when we get an invocation with the same task we can read the result and issue receipt without rerunning a task. Could be written on first receipt. It is keyed with `${task.cid}/${task.cid}.result`.

### Consumers

We keep 365 days of data history in the stream that can be replayed as needed when new consumers are added. A consumer of AWS Kinesis is a lambda function that will receive a batch of stream events and handle them.

UCAN Stream Consumers can be added as needed. Each consumer must perform atomic operations and be independent, so that we tolerate failures and can easily replay the stream if needed.

### Databases

Consumers might need other infrastructure resources to track state based on the events that go through the stream. For instance, to track system wide metrics we have the `admin-metrics` table and to track space metrics we have the `space-metrics` table.

The `admin-metrics` table has a partition key `name` with the metric name we keep track. With this, we can easily update and query each of the `admin` metrics we care about.

In the context of `space-metrics` table, a partition key with `space` is used together with a sort key `name` with the metric name. This way, we are able to track and query each metric for a given space.

### Delivery Firehose

At the end of the invocation stream we archive UCAN invocations and receipts as JSON
logs stored in S3. We partition log storage by "type" (ie, `workflow` or `receipt`),
"op" (ie, the UCAN's ability - `store/add`, `upload/remove`, etc) and "day"
(a `%Y-%m-%d` formatted string). We designed partitioning this way to make it easy to 
find logs for a particular operation on a particular day, which is used extensively
by AWS Athena to make UCAN log queries efficient.

For example, receipts of the `store/add` operation from January 1, 2024 are stored in:

`/logs/receipt/store/add/2024-01-01`

#### Glue

We use AWS Glue to defined "tables" that take advantage of the partitioning structure
above. Glue allows us to define "columns" that map to either partition parameters or
keys and nested keys in the JSON-formatted UCAN values themselves.

#### Athena

Athena uses the tables defined in Glue to execute SQL queries as map-reduce jobs over
the parititioned UCAN logs in S3. We define a variety of useful default queries in 
the [firehose stack](../stacks/firehose-stack.js) and often use the interactive query
console in the AWS Athena console to run ad-hoc queries. 

Athena queries are efficient as long as they are constrained to only search a relatively
small number of `day`s. Queries that do not put constraints on the `day` partition key
run the risk of loading and searching a large amount of data, and should be used carefully.