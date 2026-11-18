"""Run with python3 -m unittest discover -s api -p 'test_restore_rehearsal.py'."""
import importlib.util
from contextlib import closing
import json
import pathlib
import signal
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore', pathlib.Path(__file__).with_name('restore-rehearsal.py'))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.backup = self.directory / 'tarkov-20260101.sqlite'
        self.manifest = self.backup.with_suffix('.json')
        with closing(sqlite3.connect(self.backup)) as db, db:
            db.executescript('''CREATE TABLE Bosses(BossID INTEGER PRIMARY KEY, BossName TEXT);
                CREATE TABLE Maps(MapID INTEGER PRIMARY KEY, MapName TEXT);
                CREATE TABLE Timestamps(TimestampID INTEGER PRIMARY KEY, Timestamp REAL);
                CREATE TABLE SpawnChances(SpawnChanceID INTEGER PRIMARY KEY, BossID INTEGER REFERENCES Bosses,
                    MapID INTEGER REFERENCES Maps, TimestampID INTEGER REFERENCES Timestamps, Chance REAL);
                INSERT INTO Bosses VALUES(1,'reshala'); INSERT INTO Maps VALUES(1,'Customs');
                INSERT INTO Timestamps VALUES(1,1735689600.125);
                INSERT INTO SpawnChances VALUES(1,1,1,1,0.6);''')
        self.metadata = {'file': self.backup.name, 'integrity': 'ok', 'foreign_key_errors': [],
                         'sha256': restore.digest(self.backup), 'counts': dict.fromkeys(restore.TABLES, 1)}
        self.write_manifest()

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')

    def test_valid_backup_and_historical_expectation(self):
        self.assertEqual(restore.select_backup(self.directory), (self.backup, self.manifest))
        counts, query, expected = restore.validate_backup(self.backup, self.manifest)
        self.assertEqual(counts, dict.fromkeys(restore.TABLES, 1))
        self.assertIn('startDate=2025-01-01', query)
        self.assertEqual(expected, [{'MapName': 'Customs', 'BossName': 'reshala', 'Chance': 0.6,
                                     'Timestamp': '2025-01-01T00:00:00.125Z'}])

    def test_newest_missing_manifest_fails_without_fallback(self):
        (self.directory / 'tarkov-20270101.sqlite').write_bytes(b'damaged')
        with self.assertRaisesRegex(ValueError, 'no matching manifest'):
            restore.select_backup(self.directory)

    def test_symlink_backup_is_rejected(self):
        with patch.object(pathlib.Path, 'is_symlink', return_value=True):
            with self.assertRaisesRegex(ValueError, 'ordinary files'):
                restore.select_backup(self.directory)

    def test_hash_mismatch(self):
        with self.backup.open('ab') as stream:
            stream.write(b'damaged')
        with self.assertRaisesRegex(ValueError, 'SHA256'):
            restore.validate_backup(self.backup, self.manifest)

    def test_counts_mismatch(self):
        self.metadata['counts']['Bosses'] = 2
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'counts'):
            restore.validate_backup(self.backup, self.manifest)

    def test_invalid_manifest(self):
        self.metadata['file'] = '../other.sqlite'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'manifest'):
            restore.validate_backup(self.backup, self.manifest)

    def test_foreign_key_failure_even_with_valid_hash(self):
        with closing(sqlite3.connect(self.backup)) as db, db:
            db.execute('UPDATE SpawnChances SET BossID = 999')
        self.metadata['sha256'] = restore.digest(self.backup)
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'foreign keys'):
            restore.validate_backup(self.backup, self.manifest)

    def test_container_is_isolated_and_removed_on_api_failure(self):
        calls = []
        def command(args, timeout=30):
            calls.append(args)
            return 'sha256:fixture'
        health = {'status': 'ok', 'database': {'counts': self.metadata['counts']}, 'collection': {'enabled': False}}
        result = subprocess.CompletedProcess([], 0, stdout='', stderr='')
        with patch.object(restore, 'command', side_effect=command), patch.object(restore, 'fetch', side_effect=[health, []]), \
                patch.object(restore.os, 'chown', create=True), patch.object(restore.subprocess, 'run', return_value=result) as remove:
            with self.assertRaisesRegex(ValueError, 'Historical API'):
                restore.rehearse(self.backup, self.manifest, 'production:local')
        run = calls[1]
        self.assertIn('--read-only', run)
        self.assertEqual(run[run.index('--network') + 1], 'none')
        self.assertNotIn('-p', run)
        self.assertIn('SCHEDULER_ENABLED=false', run)
        self.assertIn('sha256:fixture', run)
        mount = run[run.index('--mount') + 1]
        self.assertNotIn(str(self.backup), mount)
        self.assertIn('tarkov-restore-', mount)
        self.assertEqual(remove.call_args.args[0][:3], ['docker', 'rm', '-f'])

    def test_termination_while_container_active_cleans_up_and_reports_failure(self):
        original_handlers = {number: signal.getsignal(number) for number in (signal.SIGTERM, signal.SIGINT)}
        report = self.directory / 'report.json'
        result = subprocess.CompletedProcess([], 0, stdout='', stderr='')
        def interrupt(_container, _path):
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
        with patch('sys.argv', ['restore-rehearsal.py', '--backups', str(self.directory), '--report', str(report)]), \
                patch.object(restore, 'command', return_value='sha256:fixture'), \
                patch.object(restore, 'fetch', side_effect=interrupt), \
                patch.object(restore.os, 'chown', create=True), \
                patch.object(restore.subprocess, 'run', return_value=result) as remove, patch('builtins.print'):
            self.assertEqual(restore.main(), 1)
        self.assertEqual(remove.call_args.args[0][:3], ['docker', 'rm', '-f'])
        saved = json.loads(report.read_text())
        self.assertFalse(saved['ok'])
        self.assertIn('SIGTERM', saved['error'])
        self.assertEqual({number: signal.getsignal(number) for number in original_handlers}, original_handlers)


if __name__ == '__main__':
    unittest.main()
