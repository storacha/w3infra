#!/bin/bash

mkdir data
wrangler d1 execute access-staging --command "SELECT * from delegations_v3" --json | jq ".[0].results" > data/delegations.json
wrangler d1 execute access-staging --command "SELECT * from provisions" --json | jq ".[0].results" > data/provisions.json