"""Daily verified online backups. Retain 14 pairs in the dedicated daily directory."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
destination = root.parent / 'backups' / 'daily'
result = subprocess.run([sys.executable, str(root / 'nas' / 'backup.py'),
                         str(root / 'data' / 'tarkov-time-capsule.sqlite'), str(destination)],
                        check=True, text=True, capture_output=True)
report = json.loads(result.stdout)
current = destination / report['file']
if report['integrity'] != 'ok' or report['foreign_key_errors'] or hashlib.sha256(current.read_bytes()).hexdigest() != report['sha256']:
    raise SystemExit('New backup verification failed; retention skipped')
# Only this dedicated directory is pruned; imported/manual recovery points stay intact.
pattern = re.compile(r'tarkov-\d{8}T\d{12}Z\.sqlite')
pairs = []
for candidate in sorted(destination.iterdir()):
    manifest = candidate.with_suffix('.json')
    if candidate.is_symlink() or manifest.is_symlink() or not pattern.fullmatch(candidate.name) or not manifest.is_file():
        continue
    saved = json.loads(manifest.read_text())
    if saved.get('file') != candidate.name or saved.get('integrity') != 'ok' or saved.get('foreign_key_errors') != []:
        continue
    if hashlib.sha256(candidate.read_bytes()).hexdigest() != saved.get('sha256'):
        continue
    pairs.append((candidate, manifest))
for candidate, manifest in pairs[:-14]:
    candidate.unlink()
    manifest.unlink()
print(result.stdout, end='')
print(f'Validated {len(pairs)} daily recovery points; retained latest 14.')
