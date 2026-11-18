# Automated restore rehearsal

Run from the repository root on the Linux container host, using Python 3.11+ and Docker:

```sh
python3 api/restore-rehearsal.py \
  --backups /absolute/path/to/backups \
  --image tarkov-time-capsule:local \
  --report /absolute/path/to/operations/restore-rehearsal.json
```

The command selects the newest `tarkov-*.sqlite` backup and requires its matching JSON manifest from `api/backup.py`. Both must be ordinary files inside the supplied backup directory; symlinks are rejected. It fails if that backup is damaged; it does not silently fall back to an older backup. It verifies SHA256, SQLite integrity, foreign keys and all four archive table counts, then copies the database to a temporary directory.

The rehearsal starts the exact locally installed production image ID with no network access, published ports, production data, credentials, subscriptions or Discord processes. The collector is disabled. The process runs as UID/GID 1000 with the production memory/CPU/PID limits, a read-only root filesystem, dropped capabilities, a writable disposable data directory and restricted temporary storage. Image downloads are not attempted.

Docker exec runs local HTTP requests inside the isolated container. Checks require healthy application/database counts, a disabled collector, and historical API observations matching an independently queried SQLite reference. The reference window is anchored to the oldest archived observation, so its date is fixed for an unchanged archive. This is an actual production-runtime recovery check, not merely a database integrity scan.

The container is removed before the temporary database is deleted, including on failure or SIGTERM/SIGINT cancellation. Additional cancellation signals are ignored while bounded cleanup and reporting complete. Each Docker operation has a timeout and readiness has a 60-second deadline. The original backup hash is checked again at completion. JSON reports are replaced atomically, created with mode 0600, include pass/fail status and return nonzero on failure. Schedule failure should be routed through the host's existing monitoring. Give the service at least 45 seconds to finish cleanup before sending SIGKILL.

Schedule weekly with a host service/timer (a 180-second service timeout is sufficient under normal local conditions). The service account needs Docker access and permission to read backups/write the report. It must be UID 1000 or have permission to set the copied directory and database ownership to UID/GID 1000; this never changes the original backup ownership. Use an operations directory outside the source tree for reports. Do not run concurrent rehearsals against the same report filename.

Fixture validation tests require only Python:

```sh
python3 -m unittest discover -s api -p test_restore_rehearsal.py
```

This verifies the archive and application recovery path. Use the documented full recovery procedure when restoring Discord settings, including reapplying privacy deletion records before enabling notifications.
