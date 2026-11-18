"""Rehearse a verified backup in an isolated instance of the production image.

Uses only Python's standard library and Docker. Never mounts the backup or live data.
"""
import argparse
from contextlib import closing, ExitStack
import datetime
import hashlib
import json
import os
import pathlib
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time
import urllib.parse
import uuid

TABLES = ('Bosses', 'Maps', 'Timestamps', 'SpawnChances')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def select_backup(directory):
    directory = directory.resolve()
    candidates = sorted(directory.glob('tarkov-*.sqlite'), reverse=True)
    if not candidates:
        raise ValueError('No SQLite backups found')
    # Fail on a damaged newest backup rather than silently validating an older one.
    backup = candidates[0]
    manifest = backup.with_suffix('.json')
    if not backup.is_file() or backup.is_symlink() or manifest.is_symlink() or backup.resolve().parent != directory:
        raise ValueError('Backup and manifest must be ordinary files inside the backup directory')
    if not manifest.is_file():
        raise ValueError('Newest backup has no matching manifest')
    return backup, manifest


def validate_backup(backup, manifest):
    metadata = json.loads(manifest.read_text(encoding='utf-8'))
    if metadata.get('file') != backup.name or metadata.get('integrity') != 'ok' or metadata.get('foreign_key_errors') != []:
        raise ValueError('Invalid backup manifest')
    if metadata.get('sha256') != digest(backup):
        raise ValueError('Backup SHA256 does not match manifest')
    with closing(sqlite3.connect(backup.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Backup SQLite integrity or foreign keys failed')
        counts = {table: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in TABLES}
        if metadata.get('counts') != counts:
            raise ValueError('Backup table counts do not match manifest')
        row = db.execute('''SELECT Maps.MapName, Bosses.BossName, SpawnChances.Chance, Timestamps.Timestamp
            FROM SpawnChances JOIN Maps USING(MapID) JOIN Bosses USING(BossID)
            JOIN Timestamps USING(TimestampID) ORDER BY Timestamps.Timestamp, SpawnChanceID LIMIT 1''').fetchone()
        if row is None:
            raise ValueError('Backup contains no historical observation to rehearse')
        timestamp = datetime.datetime.fromtimestamp(row[3], datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        # A one-second window accommodates millisecond rounding of stored timestamps.
        start = datetime.datetime.fromtimestamp(int(row[3]), datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        end = datetime.datetime.fromtimestamp(int(row[3]) + 1, datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        expected = db.execute('''SELECT Maps.MapName, Bosses.BossName, SpawnChances.Chance, Timestamps.Timestamp
            FROM SpawnChances JOIN Maps USING(MapID) JOIN Bosses USING(BossID) JOIN Timestamps USING(TimestampID)
            WHERE Timestamps.Timestamp BETWEEN ? AND ? AND Maps.MapName = ? AND Bosses.BossName = ?''',
            (int(row[3]), int(row[3]) + 1, row[0], row[1])).fetchall()
    records = [{'MapName': r[0], 'BossName': r[1], 'Chance': r[2], 'Timestamp': datetime.datetime.fromtimestamp(r[3], datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')} for r in expected]
    query = '/api/spawnchance?' + urllib.parse.urlencode(dict(startDate=start, endDate=end, mapName=row[0], bossName=row[1]))
    return counts, query, records


def command(args, timeout=30):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()


def fetch(container, path):
    script = "const r=await fetch('http://127.0.0.1:3000'+process.argv[1]);if(!r.ok)throw Error('HTTP '+r.status);console.log(await r.text())"
    return json.loads(command(['docker', 'exec', container, '/nodejs/bin/node', '--input-type=module', '-e', script, path], timeout=10))


def remove_container(name):
    # Cleanup runs before disposal of its writable database directory.
    result = subprocess.run(['docker', 'rm', '-f', name], capture_output=True, text=True, timeout=30)
    if result.returncode and 'No such container' not in result.stderr:
        raise RuntimeError('Could not remove restore rehearsal container: ' + result.stderr.strip())


def rehearse(backup, manifest, image):
    original_hash = digest(backup)
    counts, query, expected = validate_backup(backup, manifest)
    name = 'tarkov-restore-' + uuid.uuid4().hex[:12]
    try:
        image_id = command(['docker', 'image', 'inspect', '--format={{.Id}}', image])
        with ExitStack() as stack:
            temporary = stack.enter_context(tempfile.TemporaryDirectory(prefix='tarkov-restore-'))
            stack.callback(remove_container, name)
            data = pathlib.Path(temporary) / 'data'
            data.mkdir()
            restored = data / 'tarkov-time-capsule.sqlite'
            shutil.copyfile(backup, restored)
            if digest(restored) != original_hash:
                raise ValueError('Disposable restore does not match backup')
            if hasattr(os, 'chown'):
                os.chown(data, 1000, 1000)
                os.chown(restored, 1000, 1000)
            data.chmod(0o700)
            restored.chmod(0o600)
            command(['docker', 'run', '-d', '--name', name, '--network', 'none', '--read-only',
                     '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                     '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '128',
                     '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--mount', f'type=bind,src={data},dst=/data',
                     '-e', 'SCHEDULER_ENABLED=false', '-e', 'DATABASE_PATH=/data/tarkov-time-capsule.sqlite',
                     '-e', 'PORT=3000', '-e', 'NODE_OPTIONS=--max-old-space-size=256', image_id])
            deadline = time.monotonic() + 60
            while True:
                try:
                    health = fetch(name, '/healthz')
                    break
                except (subprocess.SubprocessError, json.JSONDecodeError):
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Restored application did not become healthy')
                    time.sleep(1)
            if health.get('status') != 'ok' or health.get('database', {}).get('counts') != counts or health.get('collection', {}).get('enabled') is not False:
                raise ValueError('Restored health/counts/scheduler validation failed')
            actual = fetch(name, query)
            canonical = lambda rows: sorted(json.dumps(row, sort_keys=True) for row in rows)
            if canonical(actual) != canonical(expected):
                raise ValueError('Historical API result does not match restored database')
            return {'image': image, 'image_id': image_id, 'backup': backup.name, 'sha256': original_hash,
                    'counts': counts, 'historical_query': query, 'historical_rows': len(expected)}
    finally:
        if digest(backup) != original_hash:
            raise ValueError('Original backup changed during rehearsal')


def run_cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backups', type=pathlib.Path, default=pathlib.Path('../backups'))
    parser.add_argument('--image', default='tarkov-time-capsule:local')
    parser.add_argument('--report', type=pathlib.Path, default=pathlib.Path('../backups/restore-rehearsal.json'))
    args = parser.parse_args()
    report = {'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'ok': False}
    try:
        backup, manifest = select_backup(args.backups.resolve())
        report.update(rehearse(backup, manifest, args.image))
        report['ok'] = True
    except Exception as error:
        report['error'] = str(error)
    report['finished_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.report.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(args.report)
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


def main():
    def cancel(signum, _frame):
        # Ignore additional cancellation while bounded container cleanup/reporting runs.
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        raise InterruptedError('Restore rehearsal cancelled by ' + signal.Signals(signum).name)

    previous = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGINT)}
    try:
        for number in previous:
            signal.signal(number, cancel)
        return run_cli()
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


if __name__ == '__main__':
    raise SystemExit(main())
