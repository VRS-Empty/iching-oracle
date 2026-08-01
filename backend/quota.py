"""
quota.py
─────────────────────────────────────────────────────────────────────────────
Cost control: a per-device daily allowance plus a coarse per-IP rate limit.

The client also tracks its own allowance in AsyncStorage so the UI can show a
remaining count without a round trip, but that copy is trivially editable —
this module is the authority.

KNOWN LIMITATION (accepted deliberately)
────────────────────────────────────────
`is_premium` is asserted by the client. The app's IAP layer is still a mock
(usePremium writes a flag to AsyncStorage), so there is no receipt for the
server to verify. The premium allowance is therefore capped rather than
trusted: a forged flag raises the ceiling from 3 to 20 questions per day, not
to unlimited. Real verification requires App Store receipt validation.

Quota counts live in SQLite. On Render's free tier the filesystem is ephemeral,
so a redeploy resets counts — users may get a few extra questions. Accepted;
moving to Postgres would close it.
─────────────────────────────────────────────────────────────────────────────
"""

import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

import config

_db_lock = threading.Lock()


def _today():
    """UTC date key — deterministic regardless of server or device timezone."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _connect(db_path=None):
    path = str(db_path or config.QUOTA_DB_PATH)
    connection = sqlite3.connect(path, timeout=5.0)
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def init_db(db_path=None):
    with _db_lock, _connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS usage (
                device_id TEXT    NOT NULL,
                day       TEXT    NOT NULL,
                count     INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (device_id, day)
            )
            """
        )


def daily_limit(is_premium):
    return config.PREMIUM_DAILY_LIMIT if is_premium else config.FREE_DAILY_LIMIT


def consume(device_id, is_premium, db_path=None):
    """
    Atomically records one question against today's allowance.

    Returns (allowed, remaining, limit). When the allowance is exhausted the
    counter is left untouched and allowed is False.
    """
    limit = daily_limit(is_premium)
    day = _today()

    with _db_lock, _connect(db_path) as connection:
        cursor = connection.execute(
            "SELECT count FROM usage WHERE device_id = ? AND day = ?",
            (device_id, day),
        )
        row = cursor.fetchone()
        used = row[0] if row else 0

        if used >= limit:
            return False, 0, limit

        connection.execute(
            """
            INSERT INTO usage (device_id, day, count) VALUES (?, ?, 1)
            ON CONFLICT(device_id, day) DO UPDATE SET count = count + 1
            """,
            (device_id, day),
        )
        return True, max(0, limit - (used + 1)), limit


def refund(device_id, db_path=None):
    """Returns a consumed credit — used when generation fails after consuming."""
    day = _today()
    with _db_lock, _connect(db_path) as connection:
        connection.execute(
            """
            UPDATE usage SET count = MAX(0, count - 1)
            WHERE device_id = ? AND day = ?
            """,
            (device_id, day),
        )


def remaining(device_id, is_premium, db_path=None):
    """Reads the allowance left today without consuming any of it."""
    limit = daily_limit(is_premium)
    with _db_lock, _connect(db_path) as connection:
        cursor = connection.execute(
            "SELECT count FROM usage WHERE device_id = ? AND day = ?",
            (device_id, _today()),
        )
        row = cursor.fetchone()
    return max(0, limit - (row[0] if row else 0))


# ─── Rate limiting ────────────────────────────────────────────────────────────
#
# A sliding window held in memory. Render's free tier runs a single instance, so
# a shared store would add a dependency without adding correctness. This is an
# abuse brake, not the cost control — the daily quota above is that.

class RateLimiter:
    def __init__(self, max_requests, window_seconds):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key, now=None):
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits[key]
            cutoff = now - self.window_seconds
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return False
            hits.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = RateLimiter(
    config.RATE_LIMIT_REQUESTS, config.RATE_LIMIT_WINDOW_SECONDS
)
