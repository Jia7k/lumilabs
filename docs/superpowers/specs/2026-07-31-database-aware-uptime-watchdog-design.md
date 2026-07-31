# Database-Aware Uptime Watchdog Design

**Date:** 2026-07-31

## Goal

Keep the Lumi5 production site recoverable through 7 August 2026 when MySQL is
still marked active by systemd but has stopped answering requests.

The change must not restart healthy services, expose database credentials,
modify application code or data, or add a separately billed Google Cloud
service.

## Verified Baseline

- `/usr/local/sbin/lumilabs-uptime-watchdog` runs from a systemd timer every
  five minutes through 7 August 2026 UTC.
- The watchdog currently restarts MySQL, Apache, or the Lumi5 backend when the
  corresponding systemd unit is inactive.
- It verifies the backend readiness endpoint and local homepage after the unit
  checks.
- If backend readiness fails while MySQL remains marked active, it restarts only
  the backend. This cannot repair a MySQL process that is active but
  unresponsive.
- `mysqladmin --protocol=socket ping` returns exit status zero while the live
  MySQL server is responding. It does not require the watchdog to read or store
  the application database password.
- MySQL and the backend already use systemd `Restart=on-failure`; the watchdog
  is the slower recovery layer for failures that do not terminate a process.

## Scope

The implementation changes only the production watchdog script. The existing
timer schedule, service unit, backend sandbox, database configuration,
application code, firewall, snapshots, and monitoring configuration remain
unchanged.

Before deployment, preserve the current watchdog with its permissions and
SHA-256 digest in the root-only incident evidence directory.

## Recovery Design

Each watchdog run replaces the existing generic MySQL service-state check with
one combined MySQL health check. This prevents the inactive-service path and
the liveness-probe path from restarting MySQL twice in the same run. The
existing generic service-state checks for Apache and the Lumi5 backend remain
unchanged.

The combined check first reads the MySQL systemd state. If MySQL is active, it
runs a credential-free liveness probe with a hard timeout so an unresponsive
socket cannot stall the watchdog indefinitely.

When MySQL is active and the probe succeeds, the new path takes no action.
Healthy MySQL, backend, and Apache processes are not restarted.

When MySQL is inactive or the probe fails:

1. Write a `daemon.err` journal entry describing the failed liveness check.
2. Clear any systemd start-limit state for MySQL with `systemctl reset-failed`.
3. Restart MySQL once.
4. Poll the same timeout-bounded liveness probe for up to 20 seconds at
   five-second intervals.
5. If MySQL recovers, restart the Lumi5 backend once so it opens a fresh
   connection pool, then verify `/api/ready`.
6. If MySQL or application readiness does not recover, write a `daemon.crit`
   entry and finish the watchdog run without entering an unbounded restart
   loop.

The existing Apache, backend-readiness, scanner-removal, malicious-directory,
and disk-pressure checks remain intact. The watchdog continues to run every
five minutes, so a later run can retry after a transient infrastructure issue.

## Safety and Failure Handling

- The probe output is suppressed, so the expected unauthenticated MySQL
  response is not added to routine logs.
- No password, JWT secret, environment file, or database record is read or
  changed by the new path.
- Restarts are conditional on a failed probe and are bounded to one MySQL and
  one backend restart per watchdog run.
- Each MySQL probe has a hard timeout. The recovery path is therefore bounded
  even if the local socket accepts a connection but never replies.
- A failed restart is logged and does not stop the timer from scheduling the
  next watchdog run.
- Deployment uses a syntax-checked temporary file and an atomic `install` over
  the existing path. The existing script remains available for immediate
  rollback.

## Verification

Before production deployment, a mocked command harness must prove these cases:

1. Healthy MySQL: no MySQL, backend, or Apache restart.
2. MySQL inactive: the combined path resets and restarts MySQL exactly once.
3. MySQL active but liveness probe fails: MySQL is reset and restarted exactly
   once.
4. A liveness probe hangs: its timeout is treated as a failed probe and the
   watchdog continues through the bounded recovery path.
5. MySQL recovers: the backend restarts once and readiness is checked.
6. MySQL does not recover: a critical event is logged and the script exits
   without an infinite loop.

The candidate script must pass `sh -n`.

After atomic deployment, run the watchdog once against the healthy production
system and verify:

- the watchdog exits successfully;
- MySQL, Apache, the backend, SSH, rsyslog, and the timer remain active;
- MySQL, Apache, and backend restart counters do not increase during the
  healthy run;
- the public homepage, `/messages.html`, `/api/health`, and `/api/ready` return
  HTTP 200; and
- ZMap, `otheramd`, and `/usr/lib/sysfmd` remain absent.

No production fault injection will stop MySQL or intentionally interrupt the
live website.

## Rollback

If syntax, mocked tests, the healthy production run, or endpoint verification
fails, restore the preserved watchdog script atomically, run it once, and
repeat the service and HTTP checks. The systemd unit and timer do not change,
so rollback does not require a daemon reload or VM restart.

## Cost

This design creates no new Google Cloud resource. It reuses the existing VM,
systemd timer, and installed MySQL client. The five-minute probe has negligible
CPU and disk impact compared with the already running watchdog.
