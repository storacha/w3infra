#!/bin/bash

DB_NAME="${1:-access-staging}"

mkdir -p data
echo running "wrangler d1 execute $DB_NAME --command 'SELECT * from delegations_v3' --json | jq '.[0].results' > data/delegations.json"
wrangler d1 execute $DB_NAME --command 'SELECT * from delegations_v3' --json | jq '.[0].results' > data/delegations.json

echo running "wrangler d1 execute $DB_NAME --command 'SELECT * from provisions' --json | jq '.[0].results' > data/provisions.json"
wrangler d1 execute $DB_NAME --command 'SELECT * from provisions' --json | jq '.[0].results' > data/provisions.json