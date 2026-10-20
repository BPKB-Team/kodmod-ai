"""Small allowlist for evaluation tools that must never target a remote DB."""

from urllib.parse import urlsplit

LOCAL_DATABASE_HOSTS = {
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
    "postgres",
    "kodmod-postgres",
    "kodmod-learning-test-db",
}


def is_local_database_url(url: str) -> bool:
    try:
        host = (urlsplit(url).hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    return host in LOCAL_DATABASE_HOSTS or host.endswith(".localhost")
