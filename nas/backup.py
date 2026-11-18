"""Run on the NAS host: python3 nas/backup.py [data/file.sqlite] [backup-directory]."""
import datetime
import hashlib
import json
import pathlib
import sqlite3
import sys

source = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'data/tarkov-time-capsule.sqlite').resolve()
destination = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '../backups').resolve()
destination.mkdir(parents=True, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
target = destination / f'tarkov-{stamp}.sqlite'
if not source.is_file() or target.exists():
    raise SystemExit('Source missing or backup already exists')
# SQLite backup API safely includes committed WAL contents while the app is running.
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
    with sqlite3.connect(target) as copy:
        original.backup(copy)
        integrity = copy.execute('PRAGMA integrity_check').fetchone()[0]
        foreign_keys = copy.execute('PRAGMA foreign_key_check').fetchall()
        if integrity != 'ok' or foreign_keys:
            raise SystemExit('Backup validation failed; do not use this copy')
        counts = {t: copy.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
                  for t in ['Bosses', 'Maps', 'Timestamps', 'SpawnChances']}
target.chmod(0o600)
report = {'file': target.name, 'created_utc': stamp, 'integrity': integrity,
          'foreign_key_errors': foreign_keys, 'counts': counts,
          'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
target.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
