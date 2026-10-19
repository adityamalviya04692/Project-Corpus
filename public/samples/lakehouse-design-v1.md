# Northwind Aero Data Platform — Design v1 (2024)

Owner: Data Engineering, Northwind Aero (fictional sample company)
Status: Approved, March 2024

## Architecture

Engine telemetry lands as hourly CSV extracts on an SFTP server. Azure Data Factory copies the files into ADLS Gen2 every night at 01:00 UTC. A single Azure Synapse dedicated SQL pool loads the raw files with COPY INTO and runs stored procedures to build reporting tables.

There is no separate bronze or silver layer: raw files are loaded straight into staging tables, transformed in place, and overwritten on each run. History is not kept for dimension tables; the latest record wins.

## Volumes and freshness

The platform processes about 18 GB of batch data per night. Reports in Power BI refresh at 06:00 UTC, so data is up to 29 hours old by the end of the day. The nightly pipeline takes roughly 3 hours and 10 minutes end to end.

## Governance

Access is controlled with SQL roles inside Synapse. Column-level lineage is not tracked. Secrets for the SFTP connection are stored as ADF linked-service parameters.

## Costs

The Synapse pool runs at DW1000c around the clock. Monthly platform cost is about USD 21,000, of which compute is 78%.

## Known risks

- A late upstream extract delays every report for the day.
- Overwriting tables makes it impossible to audit how a value changed.
- One large join between engine events and the maintenance table regularly runs out of memory on high-volume days.
