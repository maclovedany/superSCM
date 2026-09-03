# sql-verify — a local dry run for `sql/*.sql`

Every file from `sql/15` onward was written without ever being executed. The
production database is Supabase, reachable read-only through PostgREST, and DDL
only runs in the SQL Editor, which only a human can operate. So the first time
anyone finds out a file has a bad column name is when it is pasted into the
production SQL Editor.

This harness closes that gap. It builds a throwaway PostgreSQL cluster, loads a
dump of the real schema and data, and runs every project SQL file against it.

## Run it

```sh
scripts/sql-verify/run.sh                  # everything
scripts/sql-verify/run.sh 15 16 17         # only those files
DUMP=/path/to/dump.sql scripts/sql-verify/run.sh
```

Exit status is 0 only when every pass is clean. Logs land in
`scripts/sql-verify/logs/<timestamp>/`, one file per SQL file per pass, plus
`SUMMARY.txt`.

Environment knobs:

| Variable | Effect |
| --- | --- |
| `DUMP` | path to the schema+data dump; if missing it is recovered from git |
| `DUMP_GIT_REF` | git revision to recover the dump from (default `fb5601e^:dump.sql`) |
| `KEEP_CLUSTER=1` | leave the cluster running and print how to connect and how to clean up |
| `EDITOR_TXN=1` | run pass 1 inside a single transaction, the way the Supabase SQL Editor does, so a mid-file error rolls the whole file back |
| `ORDER=25first` | apply `sql/25` before `sql/20`, to demonstrate the ordering dependency between them |
| `LOG_DIR` | where to write logs |
| `PG_SERVER_BIN`, `PSQL_BIN` | override the PostgreSQL binaries |

Requires `postgresql@17` (server binaries) and `libpq` (a psql new enough to
read a pg_dump 18 file). Both are Homebrew formulae.

## What it does

Four stages.

**Setup.** `initdb` a fresh cluster in a `mktemp -d` directory, listening on a
unix socket only so it cannot collide with any Postgres you already run. The
superuser is named `postgres`, because `sql/25-python-models.sql` gates on
`session_user in ('postgres')` and that is how Supabase is set up. Then
`prelude.sql`, then the dump.

**Pass 1 — cold, no JWT.** Runs each file in order as the Supabase SQL Editor
would: session role `postgres`, no JWT, so `auth.uid()` is NULL. The derived
tables are empty, so downstream files take only their "no data" branch.

**Seed.** `seed.sql` drives the project's own entry points to fill the derived
layer: it inserts an `auth.users` row (which fires the trigger from `sql/03`),
promotes it to ADMIN, then calls `core.run_baseline_forecast()`,
`core.run_backtest()` and `core.scan_alerts()`. No invented data — every row
comes out of the project's own functions applied to the dump's real rows.

**Pass 2 — seeded, as an admin.** Re-runs every file with data present,
impersonating that admin, each file inside one transaction that rolls back on
error. This is where runtime errors inside view definitions surface, and it also
proves whether each file is re-runnable.

**Pass 3 — the write-path RPCs.** Ten functions are never called by any project
file, so passes 1 and 2 only prove their bodies parse. plpgsql resolves tables
and columns inside a body at first execution, so a bad column reference survives
both earlier passes. `exercise.sql` calls each once against the seeded data,
inside savepoints, and rolls everything back.

The cluster is stopped and its directory deleted on exit, including on failure
and on Ctrl-C.

## What a result means

A pass-1 failure that pass 2 clears is a privilege or empty-data problem, not a
logic bug. A pass-2 failure that pass 1 did not hit is either a re-runnability
problem or a bug that only shows once there is data. A pass-3 failure is a
function body that has never worked.

## What this does not prove

This is not Supabase. Treat the following as untested:

- **RLS behaviour under real roles.** Everything runs as the cluster superuser,
  which bypasses row-level security. Policies are created and their expressions
  are parsed, but no policy is ever enforced against a real `anon` or
  `authenticated` session.
- **PostgREST exposure.** Whether a view is reachable over the REST API, what
  its response shape is, how an RPC's arguments are coerced from JSON, and
  whether `Exposed schemas` is configured — none of it is exercised.
- **Supabase Auth.** `auth.users` here is a 13-column stand-in for a ~35-column
  table that GoTrue owns. No password hashing, no email confirmation, no JWT is
  ever issued or verified. `auth.uid()` reads a GUC you set yourself, so it is
  impersonation, not authentication. In particular, the harness runs as
  superuser and so can always create the `on_auth_user_created` trigger on
  `auth.users`; on real Supabase that requires privileges the SQL Editor may not
  have.
- **Ownership and `security definer` reach.** Every object here is owned by one
  superuser, so a `security definer` function can read anything. On Supabase the
  owner matters and a function may reach less than it does here.
- **Extensions.** `pg_cron`, `pg_net`, `pgsodium`, Vault. The `extensions`
  schema is created empty.
- **Correctness of the numbers.** Pass 3 asserts only that a function body
  executes without raising. Nothing here checks that a forecast, a safety stock
  or a projection is *right*.
- **Data realism.** The dump predates the STEP 9 work. `raw.sales_order`,
  `raw.business_event` and `raw.item_substitute` are empty, so any branch that
  needs confirmed sales orders or business events is never taken.
- **Performance.** `fsync` is off and the dataset is small (20 items, ~2,900
  shipment rows). Nothing here predicts production query times.

## Files

| File | Purpose |
| --- | --- |
| `run.sh` | the harness |
| `prelude.sql` | Supabase stand-ins: roles, `auth` schema, `auth.users`, `auth.uid()` |
| `seed.sql` | fills the derived layer using the project's own functions |
| `exercise.sql` | calls the ten RPCs no project file calls |
| `logs/` | per-run output, gitignored |

Files covered: `sql/01`, `03`, `04`, `06`-`13`, `15`-`22`, `25`. Excluded by
design: `sql/02` (deprecated), `sql/05` and `sql/14` (one-off data scripts).
