"""Create or reset demo accounts with local defaults or private supplied passwords.

Contract:
- This script runs only when explicitly invoked; application startup never seeds users.
- It creates siswa.demo (student), guru.demo (teacher), and admin.demo (admin).
- Local defaults use "password"; --passwords-stdin supplies a password per account.
- A role conflict aborts the entire transaction.
- Passwords are hashed before storage. Existing demo accounts have only their password reset.
- Other accounts, including baysatriow, are never updated.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Mapping

from sqlalchemy import select

from api.security import hash_password
from config.settings import settings
from database.models import User
from database.session import async_session, close_db, init_db

DEMO_USERS = (
    ("siswa.demo", "Demo Siswa", "student"),
    ("guru.demo", "Demo Guru", "teacher"),
    ("admin.demo", "Demo Admin", "admin"),
)
DEFAULT_DEMO_PASSWORD = "password"  # noqa: S105 - opt-in local demo accounts only


async def _seed(passwords: Mapping[str, str] | None = None) -> int:
    supplied = passwords is not None
    usernames = [username for username, _, _ in DEMO_USERS]
    if supplied:
        if not isinstance(passwords, Mapping) or set(passwords) != set(usernames):
            raise ValueError("Supply a JSON object containing exactly the three demo usernames.")
        if any(
            not isinstance(password, str)
            or len(password) < 8
            or len(password.encode("utf-8")) > 72
            for password in passwords.values()
        ):
            raise ValueError("Each demo password must contain at least 8 characters and at most 72 bytes.")
    else:
        passwords = dict.fromkeys(usernames, DEFAULT_DEMO_PASSWORD)

    # SQL echo includes inserted password_hash values when DEBUG is enabled.
    settings.DEBUG = False
    await init_db()
    try:
        async with async_session() as session:
            result = await session.execute(select(User).where(User.username.in_(usernames)))
            existing = {user.username: user for user in result.scalars().all()}

            conflicts = [
                f"{username} already has role {existing[username].role}; expected {role}"
                for username, _, role in DEMO_USERS
                if username in existing and existing[username].role != role
            ]
            if conflicts:
                raise RuntimeError("Demo account role conflict: " + "; ".join(conflicts))

            for username, full_name, role in DEMO_USERS:
                user = existing.get(username)
                if user is None:
                    user = User(
                        username=username,
                        full_name=full_name,
                        role=role,
                        is_active=True,
                    )
                    session.add(user)
                user.password_hash = hash_password(passwords[username])
    finally:
        await close_db()

    if supplied:
        print("Demo accounts created or reset using private supplied passwords.")
    else:
        print('Demo accounts created or reset. Shared password: "password".')
    for username, _, role in DEMO_USERS:
        print(f"{username} ({role})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--passwords-stdin",
        action="store_true",
        help="Read a JSON object of demo usernames and passwords from stdin; never print passwords.",
    )
    args = parser.parse_args()
    passwords = json.load(sys.stdin) if args.passwords_stdin else None
    if args.passwords_stdin and passwords is None:
        parser.error("Supply a JSON object containing exactly the three demo usernames.")
    return asyncio.run(_seed(passwords))


if __name__ == "__main__":
    raise SystemExit(main())
