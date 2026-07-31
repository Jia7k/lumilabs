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
