#!/usr/bin/env bash
#
# Local SQL verification harness for SuperSCM.
#
# Spins up a THROWAWAY PostgreSQL cluster in a temp directory, loads the
# Supabase compatibility prelude and a dump of the real schema+data, then
# executes every project SQL file in dependency order with ON_ERROR_STOP=1.
#
# It never touches an existing cluster, the project directory, the user's
# home, or the production Supabase database. The cluster is stopped and
# the temp directory deleted on exit, including on failure or Ctrl-C.
#
# Usage:
#   scripts/sql-verify/run.sh                 # run everything
#   scripts/sql-verify/run.sh 15 16 17        # run only files matching these prefixes
#   DUMP=/path/to/dump.sql scripts/sql-verify/run.sh
#   KEEP_CLUSTER=1 scripts/sql-verify/run.sh  # leave the cluster up (prints connect info)
#
# Exit status: 0 if every file passed, 1 otherwise.

set -uo pipefail

# ── Locations ─────────────────────────────────────────────────
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/../.." && pwd)"
SQL_DIR="$PROJECT_ROOT/sql"
PRELUDE="$HERE/prelude.sql"
SEED="$HERE/seed.sql"
EXERCISE="$HERE/exercise.sql"

# The dump of the pre-STEP-9 production schema + data, extracted from git
# history. Override with DUMP=... if it lives somewhere else.
DUMP="${DUMP:-/private/tmp/claude-501/-Users-danymac-Projects-z-superSCM/27f1c366-f2c5-499f-b09b-b9572441fd7a/scratchpad/dump.sql}"

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="${LOG_DIR:-$HERE/logs/$RUN_ID}"

# ── Binaries ──────────────────────────────────────────────────
#
# The SERVER binaries must match the cluster version, so initdb/pg_ctl
# come from the installed postgresql@17 formula (17.x, same major as the
# Supabase instance, which reports 17.6).
#
# The CLIENT (psql) is taken from libpq 18, because the dump is written
# by pg_dump 18 and opens with a \restrict meta-command that psql 17
# does not understand.
PG_SERVER_BIN="${PG_SERVER_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PSQL_BIN="${PSQL_BIN:-/opt/homebrew/opt/libpq/bin/psql}"

for b in "$PG_SERVER_BIN/initdb" "$PG_SERVER_BIN/pg_ctl" "$PSQL_BIN"; do
  if [[ ! -x "$b" ]]; then
    echo "FATAL: missing required binary: $b" >&2
    echo "  brew install postgresql@17 libpq" >&2
    exit 2
  fi
done

# The dump was removed from the working tree in commit fb5601e
# ("dump.sql 제거, 오류 기록(error.md) 추가"), so its last committed version is
# the parent of that commit. If the cached copy is gone, recover it from git
# rather than making the caller hunt for it.
DUMP_GIT_REF="${DUMP_GIT_REF:-fb5601e^:dump.sql}"

if [[ ! -f "$DUMP" ]]; then
  echo "dump not found at $DUMP -- recovering it from git ($DUMP_GIT_REF)"
  mkdir -p "$(dirname "$DUMP")" 2>/dev/null
  if ! git -C "$PROJECT_ROOT" show "$DUMP_GIT_REF" >"$DUMP.tmp" 2>/dev/null; then
    rm -f "$DUMP.tmp"
    echo "FATAL: dump not found and could not be recovered from git." >&2
    echo "  Tried: git show $DUMP_GIT_REF" >&2
    echo "  Set DUMP=/path/to/dump.sql, or DUMP_GIT_REF=<rev>:<path>." >&2
    exit 2
  fi
  mv "$DUMP.tmp" "$DUMP"
  echo "  recovered $(wc -l <"$DUMP" | tr -d ' ') lines"
fi

# ── File list, in dependency order ────────────────────────────
#
# Deliberately excluded:
#   02-policies.sql      deprecated; 04-rls.sql exists to undo it
#   05-first-admin.sql   one-off data script, needs a real auth user
#   14-reload-real-data  one-off data reload, needs CSV input
ALL_FILES=(
  01-grants.sql
  03-auth.sql
  04-rls.sql
  06-core-extend.sql
  07-train-isolation.sql
  08-import.sql
  09-import-commit.sql
  10-demand-profile.sql
  11-forecast-engine.sql
  12-forecast-summary.sql
  13-backtest.sql
  15-inventory-projection.sql
  16-safety-stock-recommendation.sql
  17-virtual-operation.sql
  18-forecast-override.sql
  19-approval.sql
  20-alert.sql
  21-dashboard.sql
  22-agent.sql
  23-atp-sales.sql
  24-what-if.sql
  25-python-models.sql
  26-api.sql
  27-admin-ops.sql
  31-chart-views.sql
  29-sales-column-guard.sql
  28-anon-lockdown.sql
)

# ORDER=25first swaps sql/25 in front of sql/20. sql/25 redefines
# core.is_admin() to also accept a session_user='postgres' connection with
# no JWT -- which is exactly what the Supabase SQL Editor is. sql/20's own
# verification block calls core.scan_alerts(), which is gated on
# core.is_admin(), so sql/20 only applies cleanly once sql/25 is in place.
# This knob exists to demonstrate that dependency, not to hide it.
if [[ "${ORDER:-}" == "25first" ]]; then
  ALL_FILES=(
    01-grants.sql 03-auth.sql 04-rls.sql 06-core-extend.sql
    07-train-isolation.sql 08-import.sql 09-import-commit.sql
    10-demand-profile.sql 11-forecast-engine.sql 12-forecast-summary.sql
    13-backtest.sql 15-inventory-projection.sql
    16-safety-stock-recommendation.sql 17-virtual-operation.sql
    18-forecast-override.sql 19-approval.sql 25-python-models.sql
    20-alert.sql 21-dashboard.sql 22-agent.sql 23-atp-sales.sql
    24-what-if.sql 26-api.sql 27-admin-ops.sql 31-chart-views.sql
    29-sales-column-guard.sql
    28-anon-lockdown.sql
  )
fi

FILES=()
if [[ $# -gt 0 ]]; then
  for want in "$@"; do
    for f in "${ALL_FILES[@]}"; do
      [[ "$f" == "$want"* || "$f" == "$want" ]] && FILES+=("$f")
    done
  done
  if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "FATAL: no known SQL file matches: $*" >&2
    exit 2
  fi
else
  FILES=("${ALL_FILES[@]}")
fi

# ── Throwaway cluster ─────────────────────────────────────────
#
# mktemp -d puts this under $TMPDIR, never in the project or in $HOME.
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/superscm-sqlverify.XXXXXXXX")"
PGDATA="$WORKDIR/pgdata"
SOCKDIR="$WORKDIR/sock"
DB=superscm_verify
STARTED=0

cleanup() {
  local rc=$?
  if [[ "${KEEP_CLUSTER:-0}" == "1" && $STARTED -eq 1 ]]; then
    echo
    echo "KEEP_CLUSTER=1 -- cluster left running."
    echo "  connect: $PSQL_BIN -h $SOCKDIR -U postgres -d $DB"
    echo "  stop:    $PG_SERVER_BIN/pg_ctl -D $PGDATA stop -m fast && rm -rf $WORKDIR"
    exit $rc
  fi
  if [[ $STARTED -eq 1 ]]; then
    "$PG_SERVER_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  fi
  # Guard against ever rm -rf'ing something that is not our own mktemp dir.
  case "$WORKDIR" in
    */superscm-sqlverify.*) rm -rf "$WORKDIR" ;;
    *) echo "REFUSING to remove unexpected workdir: $WORKDIR" >&2 ;;
  esac
  exit $rc
}
trap cleanup EXIT INT TERM

mkdir -p "$LOG_DIR" "$SOCKDIR"

echo "SuperSCM SQL verification harness"
echo "  server binaries : $PG_SERVER_BIN"
echo "  psql            : $PSQL_BIN"
echo "  dump            : $DUMP"
echo "  cluster         : $PGDATA  (deleted on exit)"
echo "  logs            : $LOG_DIR"
echo

# Superuser is named `postgres` on purpose: sql/25-python-models.sql
# gates on `session_user in ('postgres')`, which is how Supabase is set up.
"$PG_SERVER_BIN/initdb" \
  -D "$PGDATA" \
  -U postgres \
  --auth=trust \
  --encoding=UTF8 \
  --locale=C \
  >"$LOG_DIR/00-initdb.log" 2>&1
if [[ $? -ne 0 ]]; then
  echo "FATAL: initdb failed -- see $LOG_DIR/00-initdb.log" >&2
  tail -20 "$LOG_DIR/00-initdb.log" >&2
  exit 2
fi

# Unix socket only (-h ''): the cluster listens on no TCP port at all, so
# it cannot collide with a running Postgres and is not reachable off-box.
"$PG_SERVER_BIN/pg_ctl" \
  -D "$PGDATA" \
  -o "-k $SOCKDIR -h '' -c fsync=off -c full_page_writes=off -c synchronous_commit=off" \
  -l "$LOG_DIR/00-postmaster.log" \
  -w -t 60 start >"$LOG_DIR/00-pgctl.log" 2>&1
if [[ $? -ne 0 ]]; then
  echo "FATAL: cluster failed to start -- see $LOG_DIR/00-postmaster.log" >&2
  tail -30 "$LOG_DIR/00-postmaster.log" >&2
  exit 2
fi
STARTED=1

PSQL=("$PSQL_BIN" -h "$SOCKDIR" -U postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -d postgres -c "create database $DB" >"$LOG_DIR/00-createdb.log" 2>&1
if [[ $? -ne 0 ]]; then
  echo "FATAL: createdb failed -- see $LOG_DIR/00-createdb.log" >&2
  cat "$LOG_DIR/00-createdb.log" >&2
  exit 2
fi

# ── Load prelude + dump ───────────────────────────────────────
load_step() {
  local label="$1" path="$2" log="$3"
  printf '  %-28s ' "$label"
  "${PSQL[@]}" -d "$DB" -f "$path" >"$log" 2>&1
  if [[ $? -eq 0 ]]; then
    echo "ok"
  else
    echo "FAILED"
    echo
    echo "FATAL: $label failed. This is a HARNESS problem, not a project defect."
    echo "Last lines of $log:"
    grep -nE "^(psql:|ERROR|FATAL)" "$log" | tail -20
    exit 2
  fi
}

echo "Setup:"
load_step "prelude (Supabase stubs)" "$PRELUDE" "$LOG_DIR/00-prelude.log"
load_step "dump (schema + data)"     "$DUMP"    "$LOG_DIR/00-dump.log"
echo

# ── Run project files ─────────────────────────────────────────
#
# PASS 1 -- cold, and as the Supabase SQL Editor would run it.
#   Session role is `postgres`, no JWT, so auth.uid() is NULL and
#   core.is_admin() is false. The derived tables (forecast_result,
#   champion_model, alert) are empty, so downstream files take only
#   their "no data" branch.
#
# SEED  -- drive the project's own entry points to fill the derived
#   layer, and promote a harness admin.
#
# PASS 2 -- re-run every file with data present, impersonating that
#   admin. This is where runtime errors inside plpgsql bodies and view
#   definitions surface, and it also proves each file is re-runnable.
#
# A pass-1 failure that pass 2 clears is a privilege/empty-data issue.
# A pass-2 failure is a logic defect.

ADMIN_UID='00000000-0000-0000-0000-0000000000a1'

P1_RESULTS=(); P2_RESULTS=(); RESULTS=(); RP_PASS=0; RP_FAIL=0
P1_PASS=0; P1_FAIL=0
P2_PASS=0; P2_FAIL=0

# bash 3.2 (macOS system bash) has no namerefs, so run_pass writes into
# the globals RESULTS / RP_PASS / RP_FAIL and the caller copies them out.
run_pass() {
  local prefix="$1" as_admin="$2"
  RESULTS=()
  RP_PASS=0
  RP_FAIL=0

  for f in "${FILES[@]}"; do
    local path="$SQL_DIR/$f"
    local log="$LOG_DIR/$prefix-${f%.sql}.log"

    if [[ ! -f "$path" ]]; then
      printf '  %-40s %s\n' "$f" "SKIP (not found)"
      RESULTS[${#RESULTS[@]}]="SKIP|$f|file not found"
      continue
    fi

    printf '  %-40s ' "$f"
    local start=$(date +%s)
    if [[ "$as_admin" == "1" ]]; then
      # Pass 2 runs each file inside ONE transaction that is rolled back
      # on error. Without this, a file that dies halfway leaves the
      # schema damaged (e.g. sql/18 drops four views then fails on the
      # fifth), and every later file fails for that borrowed reason
      # instead of its own. Every project file is transaction-safe:
      # none uses CREATE INDEX CONCURRENTLY, VACUUM, or explicit
      # BEGIN/COMMIT.
      "${PSQL[@]}" -d "$DB" --single-transaction \
        -c "set statement_timeout = '300s'" \
        -c "set request.jwt.claim.sub = '$ADMIN_UID'" \
        -f "$path" >"$log" 2>&1
    elif [[ "${EDITOR_TXN:-0}" == "1" ]]; then
      # EDITOR_TXN=1 models the Supabase SQL Editor exactly: it sends the
      # whole pasted script as one query string, so PostgreSQL wraps it
      # in an implicit transaction and ANY error rolls the entire file
      # back. Use this to see whether a mid-file error merely stops the
      # script or prevents the file from being applied at all.
      "${PSQL[@]}" -d "$DB" --single-transaction \
        -c "set statement_timeout = '300s'" \
        -f "$path" >"$log" 2>&1
    else
      # Default: autocommit, so a file that dies partway still leaves its
      # earlier objects behind and later files can be evaluated.
      "${PSQL[@]}" -d "$DB" \
        -c "set statement_timeout = '300s'" \
        -f "$path" >"$log" 2>&1
    fi
    local rc=$?
    local elapsed=$(( $(date +%s) - start ))

    if [[ $rc -eq 0 ]]; then
      echo "PASS  (${elapsed}s)"
      RESULTS[${#RESULTS[@]}]="PASS|$f|${elapsed}s"
      RP_PASS=$((RP_PASS + 1))
    else
      local firsterr
      firsterr="$(grep -m1 -E '^psql:.*(ERROR|FATAL):' "$log" | sed 's|^psql:'"$SQL_DIR"'/||')"
      [[ -z "$firsterr" ]] && firsterr="$(grep -m1 -E 'ERROR:|FATAL:' "$log")"
      [[ -z "$firsterr" ]] && firsterr="exit code $rc, no ERROR line (see log)"
      echo "FAIL  (${elapsed}s)"
      echo "        $firsterr"
      RESULTS[${#RESULTS[@]}]="FAIL|$f|$firsterr"
      RP_FAIL=$((RP_FAIL + 1))
    fi
  done
}

echo "PASS 1 -- cold load, no JWT (mirrors the Supabase SQL Editor):"
run_pass p1 0
P1_RESULTS=("${RESULTS[@]}"); P1_PASS=$RP_PASS; P1_FAIL=$RP_FAIL
echo

echo "Seed (drive the project's own entry points to fill derived tables):"
printf '  %-28s ' "seed.sql"
"${PSQL[@]}" -d "$DB" -c "set statement_timeout = '600s'" -f "$SEED" \
  >"$LOG_DIR/00-seed.log" 2>&1
SEED_RC=$?
if [[ $SEED_RC -eq 0 ]]; then
  echo "ok"
  grep -E '^ (core|analytics)\.' "$LOG_DIR/00-seed.log" | sed 's/^/    /'
else
  echo "FAILED"
  echo "    seed could not run -- pass 2 will still be attempted, but the"
  echo "    derived tables stay empty. First error:"
  grep -m1 -E 'ERROR:|FATAL:' "$LOG_DIR/00-seed.log" | sed 's/^/    /'
fi
echo

echo "PASS 2 -- re-run with data present, impersonating an admin:"
run_pass p2 1
P2_RESULTS=("${RESULTS[@]}"); P2_PASS=$RP_PASS; P2_FAIL=$RP_FAIL

echo

# ── PASS 3: exercise the write-path RPCs ──────────────────────
#
# Ten RPCs are never called by any project file, so passes 1 and 2 only
# prove their bodies parse. plpgsql resolves tables and columns inside a
# body at first execution, so a bad column reference survives both
# earlier passes. This calls each once against the seeded data.
echo "PASS 3 -- call the write-path RPCs that no project file ever calls:"
EX_LOG="$LOG_DIR/00-exercise.log"
if [[ $SEED_RC -ne 0 ]]; then
  echo "  skipped -- the seed failed, so there is no data to call them with."
  EX_FAIL=0
  EX_SKIPPED=1
else
  EX_SKIPPED=0
  "${PSQL[@]}" -d "$DB" -c "set statement_timeout = '300s'" -f "$EXERCISE" \
    >"$EX_LOG" 2>&1
  # Attribute each ERROR line to the "### EXERCISE <name>" marker above it.
  awk '
    /^### FIXTURES/ { print "  fixtures:" substr($0, 14); next }
    /^### EXERCISE/ { name = $0; sub(/^### EXERCISE /, "", name); bad = 0; next }
    /ERROR:|FATAL:/ {
      if (name != "" && bad == 0) {
        printf "  %-62s FAIL\n", name
        printf "        %s\n", $0
        bad = 1; nfail++
      }
      next
    }
    END { print "@@NFAIL=" nfail+0 }
  ' "$EX_LOG" >"$LOG_DIR/00-exercise-verdict.txt"
  grep -v '^@@NFAIL=' "$LOG_DIR/00-exercise-verdict.txt"
  EX_FAIL=$(sed -n 's/^@@NFAIL=//p' "$LOG_DIR/00-exercise-verdict.txt")
  EX_TOTAL=$(grep -c '^### EXERCISE' "$EX_LOG")
  echo "  $((EX_TOTAL - EX_FAIL))/$EX_TOTAL RPCs executed without raising an internal error."
  echo "  (a clean domain message such as \"batch not found\" counts as executing)"
fi
echo

# ── Summary ───────────────────────────────────────────────────
{
  echo
  echo "══════════════════════════════════════════════════════════════════════"
  echo " SUMMARY over ${#FILES[@]} file(s)"
  echo "   pass 1 (cold, no JWT)        : $P1_PASS passed, $P1_FAIL failed"
  echo "   seed                         : $([[ $SEED_RC -eq 0 ]] && echo ok || echo FAILED)"
  echo "   pass 2 (seeded, as admin)    : $P2_PASS passed, $P2_FAIL failed"
  if [[ $EX_SKIPPED -eq 1 ]]; then
    echo "   pass 3 (write-path RPCs)     : skipped (seed failed)"
  else
    echo "   pass 3 (write-path RPCs)     : $((EX_TOTAL - EX_FAIL))/$EX_TOTAL executed, $EX_FAIL failed"
  fi
  echo "══════════════════════════════════════════════════════════════════════"
  printf ' %-40s %-8s %s\n' "FILE" "PASS 1" "PASS 2"
  for i in "${!FILES[@]}"; do
    IFS='|' read -r s1 f1 d1 <<<"${P1_RESULTS[$i]:-|${FILES[$i]}|}"
    IFS='|' read -r s2 f2 d2 <<<"${P2_RESULTS[$i]:-|${FILES[$i]}|}"
    printf ' %-40s %-8s %s\n' "${FILES[$i]}" "${s1:-?}" "${s2:-?}"
  done
  echo
  echo " Failures in detail:"
  any=0
  for r in "${P1_RESULTS[@]}"; do
    IFS='|' read -r st file detail <<<"$r"
    if [[ "$st" == "FAIL" ]]; then echo "  [pass 1] $file"; echo "           $detail"; any=1; fi
  done
  for r in "${P2_RESULTS[@]}"; do
    IFS='|' read -r st file detail <<<"$r"
    if [[ "$st" == "FAIL" ]]; then echo "  [pass 2] $file"; echo "           $detail"; any=1; fi
  done
  [[ $any -eq 0 ]] && echo "  (none)"
  echo
  echo " logs: $LOG_DIR"
} | tee "$LOG_DIR/SUMMARY.txt"

if [[ $P1_FAIL -eq 0 && $P2_FAIL -eq 0 && $SEED_RC -eq 0 && ${EX_FAIL:-0} -eq 0 ]]; then
  exit 0
else
  exit 1
fi
