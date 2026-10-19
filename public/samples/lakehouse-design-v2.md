# Northwind Aero Data Platform — Design v2 (2026)

Owner: Data Engineering, Northwind Aero (fictional sample company)
Status: In production since February 2026. Supersedes Design v1.

## Architecture

Engines now stream telemetry through Azure Event Hubs. Azure Databricks Structured Streaming ingests the events into Delta Lake on ADLS Gen2 following a medallion architecture: bronze keeps raw events, silver holds cleaned and de-duplicated records, gold serves star-schema models to Power BI. Maintenance and fleet reference data still arrive in batch and are merged with Delta MERGE.

Dimension tables use SCD Type 2 so every change to an engine's configuration is preserved with valid-from and valid-to dates. Orchestration moved to Databricks Workflows; Azure Data Factory is kept only for the reference-data copies.

## Volumes and freshness

The platform processes about 27 GB of streaming data per day plus 5–7 GB of batch data. The freshness SLA for gold tables is 15 minutes. The heaviest Spark job, the engine-history join, now completes in 14 minutes instead of 52.

## Governance

Unity Catalog manages permissions, fine-grained access and column-level lineage. Data quality checks run at every medallion layer and failed rows are quarantined rather than dropped. Secrets live in Azure Key Vault-backed secret scopes and jobs run as service principals.

## Costs

Clusters are right-sized per job and auto-terminate; tables are compacted with OPTIMIZE and Z-ORDER. Monthly platform cost is about USD 12,600, roughly 40% lower than v1.

## Open issues

- Late-arriving events older than 48 hours are not yet re-processed automatically.
- Two legacy Power BI reports still read from the retired Synapse pool and must be migrated by Q3 2026.
