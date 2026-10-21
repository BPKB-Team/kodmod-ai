#!/usr/bin/env bash
# Opt-in demo provisioning on the VPS. Fresh installs use unique random passwords.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ "$EUID" == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
exec 9>/run/lock/kodmod-maintenance.lock
flock -n 9 || { echo 'A KODMOD backup or deployment is already running.' >&2; exit 1; }
bash scripts/release.sh check
python3 - <<'PY'
import json
import os
import secrets
from pathlib import Path

directory = Path('.runtime')
directory.mkdir(mode=0o700, exist_ok=True)
directory.chmod(0o700)
path = directory / 'demo-accounts.json'
if not path.exists():
    passwords = {name: secrets.token_urlsafe(24) for name in ('siswa.demo', 'guru.demo', 'admin.demo')}
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(passwords, output, indent=2)
        output.write('\n')
    owner = Path('.env').stat()
    os.chown(path, owner.st_uid, owner.st_gid)
path.chmod(0o600)
with path.open() as source:
    passwords = json.load(source)
expected = {'siswa.demo', 'guru.demo', 'admin.demo'}
if not isinstance(passwords, dict) or set(passwords) != expected:
    raise SystemExit('Demo credentials must contain exactly the three demo usernames.')
shared_password = all(
    isinstance(value, str) and value == 'password' for value in passwords.values()
)
minimum_length = 8 if shared_password else 16
if any(
    not isinstance(value, str)
    or len(value) < minimum_length
    or len(value.encode('utf-8')) > 72
    for value in passwords.values()
):
    raise SystemExit(f'VPS demo passwords must have at least {minimum_length} characters and at most 72 bytes.')
if not shared_password and len(set(passwords.values())) != 3:
    raise SystemExit(
        'VPS demo accounts must use different passwords unless all three use the configured shared demo password.'
    )
print('Private demo credentials ready: .runtime/demo-accounts.json')
PY
# Only database records change; the online dump keeps the app available.
bash scripts/release.sh backup
# Mount the checked-out seeder so an application image rebuild is unnecessary.
bash scripts/release.sh compose run --rm --no-deps -T \
  -v "$PWD/apps/ai-engine/scripts/seed_demo_users.py:/app/scripts/seed_demo_users.py:ro" \
  ai-engine python -m scripts.seed_demo_users --passwords-stdin < .runtime/demo-accounts.json
echo 'Demo accounts provisioned. Read passwords privately from .runtime/demo-accounts.json.'
