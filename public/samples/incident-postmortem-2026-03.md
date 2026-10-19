# Post-mortem: engine-history job failures (March 2026)

Severity: SEV-2 · Duration: 3 days · Author: Data Engineering on-call · Northwind Aero (fictional sample)

## What happened

From 9 to 11 March 2026 the nightly engine-history Spark job failed four times with executor out-of-memory errors. Gold tables missed their freshness SLA by up to 6 hours and two morning Power BI reports showed stale numbers.

## Root cause

The job joins engine events with the maintenance table on engine_id. A small number of engines on test benches produce more than 30% of all events, so a handful of join keys were extremely hot. Spark sent each hot key to a single task, which ran out of memory while the other tasks finished in seconds. The job had already been taking 52 minutes on normal days because of the same skew.

## Fix

1. Enabled Adaptive Query Execution with skew-join handling and tuned the advisory partition size.
2. Salted the hottest keys: their rows are spread across 16 buckets and the matching maintenance rows are replicated to each bucket.
3. Right-sized the job cluster after the skew was gone.

After the fix the job runs in 14 minutes, a 73% reduction, with no out-of-memory errors since.

## Action items

- Add an alert when any single task runs longer than 5× the stage median. Owner: platform team. Due: April 2026.
- Document the salting pattern in the engineering handbook. Owner: data platform lead. Due: April 2026.
- Re-evaluate whether salting is still needed once AQE settings are standard across all jobs.
