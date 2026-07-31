# Database-Aware Uptime Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing five-minute production watchdog so it can recover MySQL when systemd reports the service as active but the local MySQL socket is unresponsive.

**Architecture:** Keep the existing single POSIX shell watchdog and replace only its generic MySQL unit check with a combined systemd-state and socket-liveness check. Exercise the real candidate script through a command-path seam and deterministic fake system commands, then install it atomically only if the live baseline hash still matches the reviewed version.

**Tech Stack:** POSIX `sh`, systemd, `mysqladmin`, GNU `timeout`, `curl`, Google Cloud CLI through Cloud Shell

## Global Constraints

- Do not change application code, application data, database configuration, the systemd timer, the watchdog service unit, firewall rules, snapshots, or monitoring resources.
- Do not read or store a database password, JWT secret, environment file, or database record.
- Do not restart healthy MySQL, Apache, or backend processes.
- Bound each watchdog run to at most one MySQL restart and one backend restart.
- Give each MySQL liveness probe a hard three-second `SIGKILL` timeout in
  production so a child that ignores `SIGTERM` cannot exceed the bound.
- Probe only `/run/mysqld/mysqld.sock` over the socket protocol, suppress probe
  output, and pass `--no-defaults` as the first `mysqladmin` option so ordinary
  option files are not read. The installed MySQL 8.0.46 client rejects the
  `--no-login-paths` option introduced in 8.2, so set
  `MYSQL_TEST_LOGIN_FILE=/dev/null` on every timeout process to suppress the
  exceptional MySQL 8.0 login-path source.
- Poll for MySQL recovery immediately and then at five-second intervals through the 20-second mark.
- Do not intentionally stop MySQL or another production service to test the failure path.
- Preserve the deployed script in `/root/incident-20260730` before installation.
- Treat SHA-256 `c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161` as the only approved production baseline. Stop if the live hash differs.
- Keep the installed script owned by `root:root` with mode `0700`.
- Add no Google Cloud resource and no separately billed service.

---

## File Structure

- Create locally for the test cycle: `/private/tmp/lumilabs-watchdog-20260731/current`
  - Exact copy of the reviewed production baseline.
- Create and version: `ops/lumilabs-uptime-watchdog`
  - Deployment source with the combined MySQL health check.
- Create and version: `ops/test-lumilabs-uptime-watchdog.sh`
  - Scenario harness that executes the deployment source with isolated fake system commands and asserts behavior.
- Preserve on the VM: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731`
  - Root-only rollback copy of the live baseline.
- Preserve on the VM: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731.sha256`
  - Digest of the rollback copy.
- Modify on the VM: `/usr/local/sbin/lumilabs-uptime-watchdog`
  - Existing watchdog; the only production file changed.

### Interfaces

- `WATCHDOG_TEST_PATH`: Optional command search path used only by the local harness. Production systemd does not set it, so the fixed trusted path remains the default.
- `MYSQL_PING_TIMEOUT`: Optional liveness timeout used by the harness as `0.2`; production systemd does not set it, so production uses `3` seconds.
- `mysql_ping() -> exit status`: Runs `MYSQL_TEST_LOGIN_FILE=/dev/null timeout
  --foreground --signal=KILL 3 mysqladmin --no-defaults --protocol=socket
  --socket=/run/mysqld/mysqld.sock ping --silent` in production and returns
  zero only when that local server answers before the hard bound.
- `wait_for_mysql() -> exit status`: Calls `mysql_ping` at most five times with four five-second intervals.
- `backend_restart_attempted`: Integer guard that prevents every branch from restarting the backend more than once per run.
- `mysql_available`: Integer state used to suppress a futile backend readiness restart when MySQL did not recover.

---

### Task 1: Build the Safe Regression Harness and Prove RED

**Files:**
- Create: `/private/tmp/lumilabs-watchdog-20260731/current`
- Create: `ops/test-lumilabs-uptime-watchdog.sh`

**Interfaces:**
- Consumes: Production watchdog baseline with SHA-256 `c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161`.
- Produces: `ops/test-lumilabs-uptime-watchdog.sh SCRIPT [SCENARIO]`, which exits zero only when all selected behavioral assertions pass.

- [ ] **Step 1: Reconstruct and verify the reviewed baseline locally**

Create `current` with this exact source, which decodes to the reviewed production
digest:

```sh
#!/bin/sh
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
TAG=lumilabs-watchdog
recovered=0

recover_service() {
  service_name="$1"
  if ! systemctl is-active --quiet "$service_name"; then
    logger -t "$TAG" -p daemon.err "$service_name was inactive; attempting restart"
    if systemctl restart "$service_name"; then
      logger -t "$TAG" -p daemon.notice "$service_name restarted"
    else
      logger -t "$TAG" -p daemon.crit "$service_name restart failed"
    fi
    recovered=1
  fi
}

recover_service mysql
recover_service apache2
recover_service lumilabs-backend

if [ "$recovered" -eq 1 ]; then
  sleep 4
fi

if ! curl -fsS --max-time 10 http://127.0.0.1:3100/api/ready >/dev/null; then
  logger -t "$TAG" -p daemon.err "backend readiness failed; attempting one restart"
  systemctl restart lumilabs-backend || true
  sleep 4
  if ! curl -fsS --max-time 10 http://127.0.0.1:3100/api/ready >/dev/null; then
    logger -t "$TAG" -p daemon.crit "backend readiness still failing after restart"
  fi
fi

if ! curl -fsS --max-time 10 http://127.0.0.1/ >/dev/null; then
  logger -t "$TAG" -p daemon.err "local homepage failed; attempting one Apache restart"
  systemctl restart apache2 || true
  sleep 3
  if ! curl -fsS --max-time 10 http://127.0.0.1/ >/dev/null; then
    logger -t "$TAG" -p daemon.crit "local homepage still failing after restart"
  fi
fi

for scanner_name in zmap otheramd; do
  scanner_pids="$(pgrep -x "$scanner_name" 2>/dev/null || true)"
  if [ -n "$scanner_pids" ]; then
    logger -t "$TAG" -p daemon.crit "scanner process $scanner_name detected and terminated"
    pkill -TERM -x "$scanner_name" 2>/dev/null || true
    sleep 1
    pkill -KILL -x "$scanner_name" 2>/dev/null || true
  fi
done

if [ -e /usr/lib/sysfmd ]; then
  logger -t "$TAG" -p daemon.crit "/usr/lib/sysfmd reappeared; manual incident response required"
fi

root_used="$(df -P / | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')"
if [ -n "$root_used" ] && [ "$root_used" -ge 90 ]; then
  logger -t "$TAG" -p daemon.err "root filesystem usage is ${root_used}%"
fi

exit 0
```

Verify it before using it:

```bash
chmod 700 /private/tmp/lumilabs-watchdog-20260731/current
sh -n /private/tmp/lumilabs-watchdog-20260731/current
shasum -a 256 /private/tmp/lumilabs-watchdog-20260731/current
```

Expected digest:

```text
c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161
```

- [ ] **Step 2: Write the scenario harness before changing the candidate**

> **Historical initial RED snapshot, superseded:** The large block below records
> the harness as first written for the initial test-first cycle. It is not the
> current implementation. The authoritative harness is the versioned
> `ops/test-lumilabs-uptime-watchdog.sh`; its current security contract is
> summarized immediately after this historical block.

The initial snapshot made one safety-only copy of an old baseline to replace
its fixed `PATH=` line when `WATCHDOG_TEST_PATH` was absent:

```sh
#!/bin/sh
set -u

script=${1:?usage: test-watchdog.sh SCRIPT [SCENARIO]}
selected=${2:-all}
passed=0
failed=0

fail_case() {
  scenario=$1
  label=$2
  expected=$3
  actual=$4
  log_file=$5
  printf 'FAIL %s: %s expected=%s actual=%s\n' "$scenario" "$label" "$expected" "$actual" >&2
  sed -n '1,240p' "$log_file" >&2
  failed=$((failed + 1))
  return 1
}

count_calls() {
  pattern=$1
  log_file=$2
  count=$(grep -Ec "$pattern" "$log_file" 2>/dev/null || true)
  printf '%s\n' "$count"
}

assert_count() {
  scenario=$1
  label=$2
  pattern=$3
  expected=$4
  log_file=$5
  actual=$(count_calls "$pattern" "$log_file")
  [ "$actual" -eq "$expected" ] || fail_case "$scenario" "$label" "$expected" "$actual" "$log_file"
}

assert_at_least_one() {
  scenario=$1
  label=$2
  pattern=$3
  log_file=$4
  actual=$(count_calls "$pattern" "$log_file")
  [ "$actual" -ge 1 ] || fail_case "$scenario" "$label" '>=1' "$actual" "$log_file"
}

run_case() {
  scenario=$1
  case_dir=$(mktemp -d "${TMPDIR:-/tmp}/lumilabs-watchdog-test.XXXXXX") || exit 1
  fakebin="$case_dir/bin"
  log_file="$case_dir/calls.log"
  state_file="$case_dir/mysqladmin.count"
  under_test="$case_dir/watchdog"
  mkdir -p "$fakebin"
  : > "$log_file"
  printf '0\n' > "$state_file"

  if grep -q 'WATCHDOG_TEST_PATH' "$script"; then
    cp "$script" "$under_test"
  else
    sed 's#^PATH=.*#PATH="${WATCHDOG_TEST_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"#' \
      "$script" > "$under_test"
  fi
  chmod 700 "$under_test"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf "systemctl %s\\n" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'if [ "$1" = "is-active" ] && [ "${3:-}" = "mysql" ] && [ "$WATCHDOG_TEST_SCENARIO" = "inactive_recover" ]; then' \
    '  exit 3' \
    'fi' \
    'exit 0' > "$fakebin/systemctl"

  printf '%s\n' \
    '#!/bin/sh' \
    'count=$(sed -n "1p" "$WATCHDOG_TEST_STATE")' \
    'count=$((count + 1))' \
    'printf "%s\\n" "$count" > "$WATCHDOG_TEST_STATE"' \
    'printf "mysqladmin call=%s %s\\n" "$count" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'case "$WATCHDOG_TEST_SCENARIO" in' \
    '  healthy|inactive_recover) exit 0 ;;' \
    '  active_recover|ready_fail) [ "$count" -eq 1 ] && exit 1; exit 0 ;;' \
    '  unrecoverable) exit 1 ;;' \
    '  hang) /bin/sleep 10; exit 0 ;;' \
    'esac' \
    'exit 1' > "$fakebin/mysqladmin"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf "timeout %s\\n" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'duration=$1' \
    'shift' \
    'if [ "$WATCHDOG_TEST_SCENARIO" = "hang" ]; then' \
    '  exit 124' \
    'fi' \
    '"$@"' > "$fakebin/timeout"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf "curl %s\\n" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'case "$WATCHDOG_TEST_SCENARIO:$*" in' \
    '  ready_fail:*127.0.0.1:3100/api/ready*) exit 1 ;;' \
    '  unrecoverable:*127.0.0.1:3100/api/ready*) exit 1 ;;' \
    '  hang:*127.0.0.1:3100/api/ready*) exit 1 ;;' \
    'esac' \
    'exit 0' > "$fakebin/curl"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf "logger %s\\n" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'exit 0' > "$fakebin/logger"

  printf '%s\n' \
    '#!/bin/sh' \
    'printf "sleep %s\\n" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'exit 0' > "$fakebin/sleep"
  printf '%s\n' '#!/bin/sh' 'exit 1' > "$fakebin/pgrep"
  printf '%s\n' \
    '#!/bin/sh' \
    'printf "pkill %s\\n" "$*" >> "$WATCHDOG_TEST_LOG"' \
    'exit 0' > "$fakebin/pkill"
  printf '%s\n' \
    '#!/bin/sh' \
    'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n"' \
    'printf "/dev/fake 100000 10000 90000 10%% /\\n"' > "$fakebin/df"
  chmod 700 "$fakebin"/*

  start_time=$(date +%s)
  WATCHDOG_TEST_PATH="$fakebin:/usr/bin:/bin" \
  WATCHDOG_TEST_SCENARIO="$scenario" \
  WATCHDOG_TEST_LOG="$log_file" \
  WATCHDOG_TEST_STATE="$state_file" \
  MYSQL_PING_TIMEOUT=0.2 \
    "$under_test"
  script_status=$?
  end_time=$(date +%s)
  elapsed=$((end_time - start_time))

  if [ "$script_status" -ne 0 ]; then
    fail_case "$scenario" script_exit 0 "$script_status" "$log_file"
    rm -rf "$case_dir"
    return 1
  fi

  case "$scenario" in
    healthy)
      assert_count "$scenario" restarts '^systemctl restart ' 0 "$log_file" || return 1
      assert_count "$scenario" error_logs '^logger .* -p daemon\.(err|crit) ' 0 "$log_file" || return 1
      assert_count "$scenario" mysql_probes '^timeout ' 1 "$log_file" || return 1
      ;;
    inactive_recover)
      assert_count "$scenario" reset_failed '^systemctl reset-failed mysql$' 1 "$log_file" || return 1
      assert_count "$scenario" mysql_restart '^systemctl restart mysql$' 1 "$log_file" || return 1
      assert_count "$scenario" backend_restart '^systemctl restart lumilabs-backend$' 1 "$log_file" || return 1
      assert_count "$scenario" mysql_probes '^timeout ' 1 "$log_file" || return 1
      ;;
    active_recover)
      assert_count "$scenario" mysql_restart '^systemctl restart mysql$' 1 "$log_file" || return 1
      assert_count "$scenario" backend_restart '^systemctl restart lumilabs-backend$' 1 "$log_file" || return 1
      assert_count "$scenario" mysql_probes '^timeout ' 2 "$log_file" || return 1
      ;;
    ready_fail)
      assert_count "$scenario" mysql_restart '^systemctl restart mysql$' 1 "$log_file" || return 1
      assert_count "$scenario" backend_restart '^systemctl restart lumilabs-backend$' 1 "$log_file" || return 1
      assert_count "$scenario" mysql_probes '^timeout ' 2 "$log_file" || return 1
      assert_at_least_one "$scenario" critical_log '^logger .* -p daemon\.crit ' "$log_file" || return 1
      ;;
    unrecoverable)
      assert_count "$scenario" mysql_restart '^systemctl restart mysql$' 1 "$log_file" || return 1
      assert_count "$scenario" backend_restart '^systemctl restart lumilabs-backend$' 0 "$log_file" || return 1
      assert_count "$scenario" mysql_probes '^timeout ' 6 "$log_file" || return 1
      assert_count "$scenario" mysql_poll_intervals '^sleep 5$' 4 "$log_file" || return 1
      assert_at_least_one "$scenario" critical_log '^logger .* -p daemon\.crit ' "$log_file" || return 1
      ;;
    hang)
      if [ "$elapsed" -gt 2 ]; then
        fail_case "$scenario" elapsed_seconds '<=2' "$elapsed" "$log_file" || return 1
      fi
      assert_count "$scenario" mysql_restart '^systemctl restart mysql$' 1 "$log_file" || return 1
      assert_count "$scenario" backend_restart '^systemctl restart lumilabs-backend$' 0 "$log_file" || return 1
      assert_count "$scenario" mysql_probes '^timeout ' 6 "$log_file" || return 1
      assert_count "$scenario" mysql_poll_intervals '^sleep 5$' 4 "$log_file" || return 1
      assert_at_least_one "$scenario" critical_log '^logger .* -p daemon\.crit ' "$log_file" || return 1
      ;;
  esac

  printf 'PASS %s\n' "$scenario"
  passed=$((passed + 1))
  rm -rf "$case_dir"
}

case "$selected" in
  all)
    for scenario in healthy inactive_recover active_recover ready_fail unrecoverable hang; do
      run_case "$scenario" || exit 1
    done
    ;;
  healthy|inactive_recover|active_recover|ready_fail|unrecoverable|hang)
    run_case "$selected" || exit 1
    ;;
  *)
    printf 'unknown scenario: %s\n' "$selected" >&2
    exit 2
    ;;
esac

printf '%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
```

The harness isolates `systemctl`, `mysqladmin`, `timeout`, `curl`, `logger`,
`sleep`, `pgrep`, `pkill`, and `df`. It accepts only the exact current
`WATCHDOG_TEST_PATH` seam or the exact reviewed legacy fixed `PATH` line and
otherwise aborts before running the candidate. It inserts `readonly PATH`
immediately after the accepted seam so later candidate assignments cannot
replace the isolated command path. Every probe assertion requires
the timeout environment and literal command
`MYSQL_TEST_LOGIN_FILE=/dev/null timeout --foreground --signal=KILL 0.2
mysqladmin --no-defaults --protocol=socket --socket=/run/mysqld/mysqld.sock
ping --silent`, so login-path isolation, duration, kill signal, ordinary
option-file isolation, option ordering, protocol, socket, silence, and ping
action are checked on every invocation. Each fake appends
relevant invocations to `$WATCHDOG_TEST_LOG`. The fake `systemctl`
returns inactive only for MySQL in the `inactive_recover` scenario. The fake
`mysqladmin` implements these literal sequences:

```text
healthy             0
inactive_recover    0
active_recover      1,0
ready_fail          1,0
unrecoverable       1,1,1,1,1,1
hang                timeout,timeout,timeout,timeout,timeout,timeout
```

The six scenario assertions are:

```text
healthy:
  zero "systemctl restart" calls
  zero daemon.err or daemon.crit log calls

inactive_recover:
  exactly one "systemctl reset-failed mysql"
  exactly one "systemctl restart mysql"
  exactly one "systemctl restart lumilabs-backend"

active_recover:
  exactly one "systemctl restart mysql"
  exactly one "systemctl restart lumilabs-backend"

ready_fail:
  exactly one "systemctl restart mysql"
  exactly one "systemctl restart lumilabs-backend"
  at least one daemon.crit log call

unrecoverable:
  exactly one "systemctl restart mysql"
  zero "systemctl restart lumilabs-backend"
  at least one daemon.crit log call

hang:
  the complete script exits within two seconds with MYSQL_PING_TIMEOUT=0.2
  exactly one "systemctl restart mysql"
  zero "systemctl restart lumilabs-backend"
  at least one daemon.crit log call
```

The harness must fail on the first mismatched literal count and print the scenario name, expected count, actual count, and captured call log.

- [ ] **Step 3: Run the active-unresponsive case against the baseline and verify RED**

Run:

```bash
ops/test-lumilabs-uptime-watchdog.sh \
  /private/tmp/lumilabs-watchdog-20260731/current active_recover
```

Expected: FAIL because the current script sees an active MySQL unit, never invokes `mysqladmin`, and records zero `systemctl restart mysql` calls instead of one. This is the required failing regression test.

- [ ] **Step 4: Commit the focused regression harness**

```bash
chmod 700 ops/test-lumilabs-uptime-watchdog.sh
sh -n ops/test-lumilabs-uptime-watchdog.sh
git add ops/test-lumilabs-uptime-watchdog.sh
git diff --cached --check
git commit -m "test: cover database-aware uptime recovery"
```

---

### Task 2: Implement the Bounded MySQL Recovery Path and Prove GREEN

**Files:**
- Create: `ops/lumilabs-uptime-watchdog`
- Test: `ops/test-lumilabs-uptime-watchdog.sh`

**Interfaces:**
- Consumes: The failing behavioral harness from Task 1.
- Produces: A syntax-valid candidate with `mysql_ping`, `wait_for_mysql`, `mysql_available`, and `backend_restart_attempted` behavior.

- [ ] **Step 1: Copy the baseline to the candidate**

```bash
cp /private/tmp/lumilabs-watchdog-20260731/current \
  ops/lumilabs-uptime-watchdog
chmod 700 ops/lumilabs-uptime-watchdog
```

- [ ] **Step 2: Add the two production defaults and state guards**

Replace the fixed path and initial state block with:

```sh
PATH="${WATCHDOG_TEST_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
export PATH
TAG=lumilabs-watchdog
MYSQL_PING_TIMEOUT="${MYSQL_PING_TIMEOUT:-3}"
recovered=0
backend_restart_attempted=0
mysql_available=0
```

Update `recover_service()` so the backend guard is set before any backend restart and a previous backend attempt is never repeated:

```sh
recover_service() {
  service_name="$1"

  if [ "$service_name" = "lumilabs-backend" ] && [ "$backend_restart_attempted" -eq 1 ]; then
    return
  fi

  if ! systemctl is-active --quiet "$service_name"; then
    logger -t "$TAG" -p daemon.err "$service_name was inactive; attempting restart"

    if [ "$service_name" = "lumilabs-backend" ]; then
      backend_restart_attempted=1
    fi

    if systemctl restart "$service_name"; then
      logger -t "$TAG" -p daemon.notice "$service_name restarted"
    else
      logger -t "$TAG" -p daemon.crit "$service_name restart failed"
    fi
    recovered=1
  fi
}
```

- [ ] **Step 3: Replace `recover_service mysql` with the combined health check**

Insert these functions after `recover_service()`:

```sh
mysql_ping() {
  MYSQL_TEST_LOGIN_FILE=/dev/null \
    timeout --foreground --signal=KILL "$MYSQL_PING_TIMEOUT" \
      mysqladmin --no-defaults --protocol=socket \
        --socket=/run/mysqld/mysqld.sock ping --silent >/dev/null 2>&1
}

wait_for_mysql() {
  attempt=1

  while [ "$attempt" -le 5 ]; do
    if mysql_ping; then
      return 0
    fi

    if [ "$attempt" -lt 5 ]; then
      sleep 5
    fi

    attempt=$((attempt + 1))
  done

  return 1
}
```

Replace `recover_service mysql` with:

```sh
if systemctl is-active --quiet mysql && mysql_ping; then
  mysql_available=1
else
  logger -t "$TAG" -p daemon.err "MySQL was inactive or unresponsive; attempting one restart"
  systemctl reset-failed mysql || true

  if systemctl restart mysql && wait_for_mysql; then
    mysql_available=1
    recovered=1
    logger -t "$TAG" -p daemon.notice "MySQL recovered after restart"

    backend_restart_attempted=1
    if systemctl restart lumilabs-backend; then
      logger -t "$TAG" -p daemon.notice "lumilabs-backend restarted after MySQL recovery"
    else
      logger -t "$TAG" -p daemon.crit "lumilabs-backend restart failed after MySQL recovery"
    fi
  else
    logger -t "$TAG" -p daemon.crit "MySQL remained unavailable after its single restart"
  fi
fi
```

Keep the existing calls to `recover_service apache2` and `recover_service lumilabs-backend` immediately after this block.

- [ ] **Step 4: Make the existing readiness branch obey the backend restart guard**

Replace the existing backend readiness block with:

```sh
if ! curl -fsS --max-time 10 http://127.0.0.1:3100/api/ready >/dev/null; then
  if [ "$mysql_available" -eq 0 ]; then
    logger -t "$TAG" -p daemon.crit "backend readiness failed while MySQL was unavailable; backend restart suppressed"
  elif [ "$backend_restart_attempted" -eq 1 ]; then
    logger -t "$TAG" -p daemon.crit "backend readiness failed after its single restart"
  else
    logger -t "$TAG" -p daemon.err "backend readiness failed; attempting one restart"
    backend_restart_attempted=1
    systemctl restart lumilabs-backend || true
    sleep 4

    if ! curl -fsS --max-time 10 http://127.0.0.1:3100/api/ready >/dev/null; then
      logger -t "$TAG" -p daemon.crit "backend readiness still failing after restart"
    fi
  fi
fi
```

Leave the homepage, scanner, `/usr/lib/sysfmd`, disk-pressure, and final `exit 0` blocks byte-for-byte unchanged.

- [ ] **Step 5: Verify syntax and run all six scenarios**

Run:

```bash
sh -n ops/lumilabs-uptime-watchdog
ops/test-lumilabs-uptime-watchdog.sh ops/lumilabs-uptime-watchdog
```

Expected:

```text
PASS healthy
PASS inactive_recover
PASS active_recover
PASS ready_fail
PASS unrecoverable
PASS hang
6 passed, 0 failed
```

- [ ] **Step 6: Run the mutation check**

Create a temporary mutation that removes the second standalone
`backend_restart_attempted=1`, which is the guard immediately before the
post-MySQL backend restart:

```bash
awk '
  /^[[:space:]]*backend_restart_attempted=1$/ {
    assignments++
    if (assignments == 2) next
  }
  { print }
' ops/lumilabs-uptime-watchdog \
  > /private/tmp/lumilabs-watchdog-20260731/candidate.mutant
chmod 700 /private/tmp/lumilabs-watchdog-20260731/candidate.mutant
```

Run:

```bash
if ops/test-lumilabs-uptime-watchdog.sh \
  /private/tmp/lumilabs-watchdog-20260731/candidate.mutant ready_fail; then
  printf 'mutation unexpectedly passed\n' >&2
  exit 1
fi
ops/test-lumilabs-uptime-watchdog.sh ops/lumilabs-uptime-watchdog
```

Expected: the mutant fails with two backend restarts; the restored candidate
finishes with `6 passed, 0 failed`.

- [ ] **Step 7: Commit the green deployment source**

```bash
git add ops/lumilabs-uptime-watchdog
git diff --cached --check
git commit -m "ops: add database-aware uptime recovery"
```

---

### Task 3: Preserve the Baseline and Install Atomically

**Files:**
- Preserve: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731`
- Preserve: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731.sha256`
- Modify: `/usr/local/sbin/lumilabs-uptime-watchdog`

**Interfaces:**
- Consumes: Fully green candidate from Task 2.
- Produces: Atomically installed root-owned production watchdog plus a verified rollback copy.

- [ ] **Step 1: Recheck the live drift guard immediately before upload**

Run through Cloud Shell:

```bash
gcloud compute ssh lumilabs --zone=us-west1-b --quiet --command='sudo sha256sum /usr/local/sbin/lumilabs-uptime-watchdog'
```

Expected live digest:

```text
c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161
```

Stop without uploading if it differs.

- [ ] **Step 2: Upload the candidate to a non-production temporary path**

Transfer the exact green `ops/lumilabs-uptime-watchdog` to `/tmp/lumilabs-uptime-watchdog.candidate` on the VM. Then run:

```bash
sudo sh -n /tmp/lumilabs-uptime-watchdog.candidate
sudo stat -c '%s %n' /tmp/lumilabs-uptime-watchdog.candidate
sudo sha256sum /tmp/lumilabs-uptime-watchdog.candidate
```

Compare the size and SHA-256 with the versioned green source. Stop on any mismatch.

Also verify the installed GNU timeout contract without touching a service:

```bash
start_seconds=$(date +%s)
set +e
/usr/bin/timeout --foreground --signal=KILL 0.2 /bin/sleep 10
timeout_status=$?
set -e
elapsed_seconds=$(( $(date +%s) - start_seconds ))
printf 'timeout_status=%s elapsed_seconds=%s\n' "$timeout_status" "$elapsed_seconds"
test "$timeout_status" -eq 124
test "$elapsed_seconds" -le 2
```

- [ ] **Step 3: Record pre-deployment restart counters**

```bash
for unit in mysql apache2 lumilabs-backend; do
  printf '%s ' "$unit"
  systemctl show "$unit" -p NRestarts --value
done
```

Save these three literal values for Task 4.

- [ ] **Step 4: Preserve the rollback artifact**

```bash
sudo install -m 700 -o root -g root \
  /usr/local/sbin/lumilabs-uptime-watchdog \
  /root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731
sudo sha256sum \
  /root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731 \
  | sudo tee \
  /root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731.sha256 \
  >/dev/null
sudo chmod 600 \
  /root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731.sha256
```

Verify the rollback artifact digest is the approved baseline digest.

- [ ] **Step 5: Install in the same filesystem and rename atomically**

```bash
sudo install -m 700 -o root -g root \
  /tmp/lumilabs-uptime-watchdog.candidate \
  /usr/local/sbin/.lumilabs-uptime-watchdog.new
sudo sh -n /usr/local/sbin/.lumilabs-uptime-watchdog.new
sudo mv -f \
  /usr/local/sbin/.lumilabs-uptime-watchdog.new \
  /usr/local/sbin/lumilabs-uptime-watchdog
sudo stat -c '%a %U:%G %n' /usr/local/sbin/lumilabs-uptime-watchdog
sudo sha256sum /usr/local/sbin/lumilabs-uptime-watchdog
```

Expected metadata:

```text
700 root:root /usr/local/sbin/lumilabs-uptime-watchdog
```

---

### Task 4: Verify the Healthy Production Path and Roll Back on Any Failure

**Files:**
- Verify: `/usr/local/sbin/lumilabs-uptime-watchdog`
- Roll back from: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731`

**Interfaces:**
- Consumes: Atomically installed candidate and pre-deployment restart counters.
- Produces: Fresh evidence that the healthy path performs no restarts and every required service and endpoint remains healthy.

- [ ] **Step 1: Run the installed watchdog once against the healthy system**

```bash
verify_since=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
sudo /usr/local/sbin/lumilabs-uptime-watchdog
printf 'watchdog_exit=%s\n' "$?"
```

Expected: `watchdog_exit=0`.

- [ ] **Step 2: Prove the healthy run did not restart services**

```bash
for unit in mysql apache2 lumilabs-backend; do
  printf '%s ' "$unit"
  systemctl show "$unit" -p NRestarts --value
done
```

Expected: all three values exactly equal the values recorded before deployment.

- [ ] **Step 3: Verify units, timer, endpoints, and compromise indicators**

```bash
systemctl is-active apache2 mysql ssh rsyslog lumilabs-backend lumilabs-watchdog.timer
for path in / /messages.html /api/health /api/ready; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" --max-time 10 \
    "http://35.212.144.149$path"
done
if pgrep -x zmap >/dev/null || pgrep -x otheramd >/dev/null || [ -e /usr/lib/sysfmd ]; then
  printf 'compromise_indicator_present\n'
  exit 1
fi
```

Expected:

```text
active
active
active
active
active
active
/ 200
/messages.html 200
/api/health 200
/api/ready 200
```

- [ ] **Step 4: Inspect only the new watchdog journal interval**

Use the `verify_since` value captured immediately before Step 1:

```bash
sudo journalctl -t lumilabs-watchdog --since "$verify_since" --no-pager
```

Expected: no `daemon.err` or `daemon.crit` entry from the healthy manual run.

- [ ] **Step 5: Execute rollback if any Task 3 or Task 4 check fails**

```bash
sudo install -m 700 -o root -g root \
  /root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731 \
  /usr/local/sbin/.lumilabs-uptime-watchdog.rollback
sudo sh -n /usr/local/sbin/.lumilabs-uptime-watchdog.rollback
sudo mv -f \
  /usr/local/sbin/.lumilabs-uptime-watchdog.rollback \
  /usr/local/sbin/lumilabs-uptime-watchdog
sudo sha256sum /usr/local/sbin/lumilabs-uptime-watchdog
```

Expected rollback digest:

```text
c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161
```

After rollback, rerun the six unit-state checks and four HTTP checks before reporting the failure.

---

### Task 5: Record the Deployment Evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-31-database-aware-uptime-watchdog.md`

**Interfaces:**
- Consumes: Candidate digest, production digest, test results, restart counters, unit states, endpoint statuses, and journal result.
- Produces: An auditable implementation record without secrets or database content.

- [ ] **Step 1: Append a concise execution record**

Append a dated `## Execution Record` section containing only:

```text
- baseline SHA-256
- candidate SHA-256
- syntax-check result
- six mocked scenario results
- mutation-check RED result
- restored GREEN result
- restart counters before and after the healthy run
- six systemd unit states
- four HTTP status codes
- watchdog journal severity result
- rollback artifact path and SHA-256
```

Do not include credentials, environment variables from production, database rows, JWTs, browser session data, or SSH keys.

- [ ] **Step 2: Commit only the updated plan record**

```bash
git add docs/superpowers/plans/2026-07-31-database-aware-uptime-watchdog.md
git diff --cached --check
git commit -m "ops: record database-aware watchdog deployment"
```

## Execution Record: 2026-07-31

- Baseline SHA-256: `c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161`.
- Initial candidate SHA-256 for the first atomic deployment: `841fc9898ab4b075fab2876f7ca0ac414e6dbc998ed95917053fef6cc18a3cf4`.
- Syntax checks: source passed; harness passed.
- Mocked scenarios: `healthy=PASS`, `inactive_recover=PASS`, `active_recover=PASS`, `ready_fail=PASS`, `unrecoverable=PASS`, `hang=PASS`; 6/6 passed.
- Mutation-check RED: `ready_fail` expected 1 backend restart, actual 2.
- Restored candidate GREEN: 6/6 mocked scenarios passed.
- Restart counters before and after the healthy run: `mysql=0/0`, `apache2=0/0`, `lumilabs-backend=0/0`.
- Systemd unit states: `apache2=active`, `mysql=active`, `ssh=active`, `rsyslog=active`, `lumilabs-backend=active`, `lumilabs-watchdog.timer=active`.
- HTTP status codes: `/=200`, `/messages.html=200`, `/api/health=200`, `/api/ready=200`.
- Watchdog journal severity: no `err` through `alert` entries since `2026-07-31 10:13:28 UTC`.
- Rollback artifact: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-db-aware-20260731`, SHA-256 `c85cd16fc5a669beaffb8f226bf90267203755477c1b3f494a593d68568e7161`.

### Hardening Follow-up: 2026-07-31

- Final candidate and live SHA-256: `2be56194d42ce76150c9c649d2dab86f8b146e86863f031c8b4a9e400f6869d1`; installed metadata `0700 root:root`, 3948 bytes.
- Syntax and portability checks: source and harness passed `sh -n` and `dash -n`.
- Mocked scenarios after hardening: `healthy=PASS`, `inactive_recover=PASS`, `active_recover=PASS`, `ready_fail=PASS`, `unrecoverable=PASS`, `hang=PASS`; 6/6 passed.
- Hardening mutation checks: missing `--signal=KILL`, extra direct `mysqladmin`, unreviewed PATH seam, and later PATH rebinding all failed as required; restored candidate passed 6/6.
- Production timeout contract: a direct child that ignored `SIGTERM` was terminated by `timeout --foreground --signal=KILL 0.2` with status 124 in 0 seconds.
- Production probe at that time: `mysqladmin --no-defaults` over `/run/mysqld/mysqld.sock` completed with status 0. This suppressed ordinary option files, but MySQL 8.0 treats `.mylogin.cnf` separately; the subsequent hardening redirects that exceptional source with `MYSQL_TEST_LOGIN_FILE=/dev/null`.
- Restart counters before and after the final healthy run: `mysql=0/0`, `apache2=0/0`, `lumilabs-backend=0/0`.
- Systemd unit states: `apache2=active`, `mysql=active`, `ssh=active`, `rsyslog=active`, `lumilabs-backend=active`, `lumilabs-watchdog.timer=active`.
- HTTP status codes: `/=200`, `/messages.html=200`, `/api/health=200`, `/api/ready=200`.
- Compromise indicators: `zmap`, `otheramd`, and `/usr/lib/sysfmd` absent.
- Watchdog journal severity: no `err` through `alert` entries since `2026-07-31 10:52:36 UTC`.
- Immediate rollback artifact: `/root/incident-20260730/lumilabs-uptime-watchdog.pre-hardening-20260731`, SHA-256 `841fc9898ab4b075fab2876f7ca0ac414e6dbc998ed95917053fef6cc18a3cf4`; original baseline rollback remains at its recorded path and SHA-256.
