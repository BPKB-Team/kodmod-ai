#!/usr/bin/env bash
# Prepare private TLS credentials and the Qdrant API key without printing them.
set -Eeuo pipefail
umask 077
[[ "$EUID" == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
env_file="$PWD/.env"
[[ -f "$env_file" ]] || { echo 'Root .env was not found.' >&2; exit 1; }

tls_root=/srv/kodmod/secrets/qdrant
parent_dir="${tls_root%/*}"
install -d -o root -g root -m 0700 "$parent_dir"
install -d -o root -g 1000 -m 0750 "$tls_root"
temp_dir="$(mktemp -d "$tls_root/.prepare.XXXXXX")"
trap 'rm -rf -- "$temp_dir"' EXIT

public_key_hash() {
  if [[ "$1" == certificate ]]; then
    openssl x509 -in "$2" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1
  else
    openssl pkey -in "$2" -pubout -outform DER | sha256sum | cut -d' ' -f1
  fi
}

valid_ca() {
  [[ -s "$tls_root/ca.crt" && -s "$tls_root/ca.key" ]] || return 1
  openssl x509 -in "$tls_root/ca.crt" -checkend 2592000 -noout >/dev/null 2>&1 || return 1
  openssl pkey -in "$tls_root/ca.key" -noout >/dev/null 2>&1 || return 1
  [[ "$(public_key_hash certificate "$tls_root/ca.crt")" == "$(public_key_hash key "$tls_root/ca.key")" ]]
}

if ! valid_ca; then
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes \
    -keyout "$temp_dir/ca.key" -out "$temp_dir/ca.crt" -days 3650 \
    -subj '/CN=KODMOD Qdrant Private CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
  install -o root -g root -m 0600 "$temp_dir/ca.key" "$tls_root/ca.key"
  install -o root -g 1000 -m 0644 "$temp_dir/ca.crt" "$tls_root/ca.crt"
fi

valid_server() {
  [[ -s "$tls_root/server.crt" && -s "$tls_root/server.key" ]] || return 1
  openssl x509 -in "$tls_root/server.crt" -checkend 2592000 -noout >/dev/null 2>&1 || return 1
  openssl verify -CAfile "$tls_root/ca.crt" "$tls_root/server.crt" >/dev/null 2>&1 || return 1
  openssl x509 -in "$tls_root/server.crt" -noout -ext subjectAltName | grep -q 'DNS:qdrant' || return 1
  [[ "$(public_key_hash certificate "$tls_root/server.crt")" == "$(public_key_hash key "$tls_root/server.key")" ]]
}

if ! valid_server; then
  cat > "$temp_dir/server.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:qdrant
EOF
  openssl req -new -newkey rsa:2048 -sha256 -nodes \
    -keyout "$temp_dir/server.key" -out "$temp_dir/server.csr" \
    -subj '/CN=qdrant' >/dev/null 2>&1
  openssl x509 -req -in "$temp_dir/server.csr" -CA "$tls_root/ca.crt" \
    -CAkey "$tls_root/ca.key" -CAcreateserial -out "$temp_dir/server.crt" \
    -days 397 -sha256 -extfile "$temp_dir/server.ext" >/dev/null 2>&1
  install -o root -g 1000 -m 0640 "$temp_dir/server.key" "$tls_root/server.key"
  install -o root -g 1000 -m 0644 "$temp_dir/server.crt" "$tls_root/server.crt"
fi

read_env() {
  awk -v name="$1" 'index($0, name "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$env_file"
}
api_key="$(read_env QDRANT_API_KEY)"
if [[ ! "$api_key" =~ ^[A-Za-z0-9_-]{32,}$ ]]; then
  api_key="$(openssl rand -hex 32)"
fi

QDRANT_API_KEY_VALUE="$api_key" python3 - "$env_file" "$tls_root" <<'PY'
import os
import stat
import sys
import tempfile
from pathlib import Path

env_path = Path(sys.argv[1])
tls_root = sys.argv[2]
secret = os.environ["QDRANT_API_KEY_VALUE"]
updates = {
    "QDRANT_ENABLED": "true",
    "QDRANT_API_KEY": secret,
    "QDRANT_TLS_ROOT": tls_root,
    "QDRANT_CA_CERT_PATH": f"{tls_root}/ca.crt",
}
metadata = env_path.stat()
lines = env_path.read_text(encoding="utf-8").splitlines()
result = []
seen = set()
for line in lines:
    key = line.partition("=")[0]
    if key in updates:
        if key not in seen:
            result.append(f"{key}={updates[key]}")
            seen.add(key)
    else:
        result.append(line)
for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")

fd, temporary = tempfile.mkstemp(prefix=".env.qdrant.", dir=env_path.parent)
try:
    os.fchmod(fd, stat.S_IMODE(metadata.st_mode))
    os.fchown(fd, metadata.st_uid, metadata.st_gid)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write("\n".join(result) + "\n")
    os.replace(temporary, env_path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
unset api_key
chmod 0750 "$tls_root"
chown root:1000 "$tls_root"
chmod 0600 "$tls_root/ca.key"
chown root:root "$tls_root/ca.key"
chmod 0644 "$tls_root/ca.crt" "$tls_root/server.crt"
chmod 0640 "$tls_root/server.key"
chown root:1000 "$tls_root/server.crt" "$tls_root/server.key"
openssl verify -CAfile "$tls_root/ca.crt" "$tls_root/server.crt" >/dev/null
test "$(stat -c '%a' "$env_file")" = 600 || chmod 0600 "$env_file"
echo 'Qdrant private TLS credentials and API key are ready; secret values were not displayed.'
