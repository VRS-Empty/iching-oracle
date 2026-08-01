"""Daily allowance and rate-limiting tests."""

import pytest

import config
import quota


@pytest.fixture(autouse=True)
def _init(db_path):
    quota.init_db(db_path)


# ─── Daily allowance ──────────────────────────────────────────────────────────

def test_free_user_gets_the_free_allowance(db_path, tight_limits):
    for expected_remaining in (2, 1, 0):
        allowed, remaining, limit = quota.consume("dev-1", False, db_path)
        assert allowed is True
        assert remaining == expected_remaining
        assert limit == 3


def test_free_user_is_blocked_after_the_allowance(db_path, tight_limits):
    for _ in range(3):
        quota.consume("dev-1", False, db_path)
    allowed, remaining, limit = quota.consume("dev-1", False, db_path)
    assert allowed is False
    assert remaining == 0
    assert limit == 3


def test_premium_user_gets_the_larger_allowance(db_path, tight_limits):
    for _ in range(5):
        assert quota.consume("dev-premium", True, db_path)[0] is True
    assert quota.consume("dev-premium", True, db_path)[0] is False


def test_devices_have_independent_allowances(db_path, tight_limits):
    for _ in range(3):
        quota.consume("dev-a", False, db_path)
    assert quota.consume("dev-a", False, db_path)[0] is False
    assert quota.consume("dev-b", False, db_path)[0] is True


def test_upgrading_to_premium_lifts_the_ceiling_same_day(db_path, tight_limits):
    """A user who upgrades mid-day should not have to wait for the reset."""
    for _ in range(3):
        quota.consume("dev-up", False, db_path)
    assert quota.consume("dev-up", False, db_path)[0] is False
    assert quota.consume("dev-up", True, db_path)[0] is True


def test_allowance_resets_on_a_new_day(db_path, tight_limits, monkeypatch):
    monkeypatch.setattr(quota, "_today", lambda: "2026-07-26")
    for _ in range(3):
        quota.consume("dev-1", False, db_path)
    assert quota.consume("dev-1", False, db_path)[0] is False

    monkeypatch.setattr(quota, "_today", lambda: "2026-07-27")
    allowed, remaining, _ = quota.consume("dev-1", False, db_path)
    assert allowed is True
    assert remaining == 2


# ─── Refund ───────────────────────────────────────────────────────────────────

def test_refund_returns_a_consumed_credit(db_path, tight_limits):
    quota.consume("dev-1", False, db_path)
    assert quota.remaining("dev-1", False, db_path) == 2
    quota.refund("dev-1", db_path)
    assert quota.remaining("dev-1", False, db_path) == 3


def test_refund_never_drives_the_counter_negative(db_path, tight_limits):
    quota.refund("never-seen", db_path)
    quota.refund("never-seen", db_path)
    assert quota.remaining("never-seen", False, db_path) == 3


def test_refund_restores_access_after_exhaustion(db_path, tight_limits):
    for _ in range(3):
        quota.consume("dev-1", False, db_path)
    assert quota.consume("dev-1", False, db_path)[0] is False
    quota.refund("dev-1", db_path)
    assert quota.consume("dev-1", False, db_path)[0] is True


# ─── Reads ────────────────────────────────────────────────────────────────────

def test_remaining_does_not_consume(db_path, tight_limits):
    assert quota.remaining("dev-1", False, db_path) == 3
    assert quota.remaining("dev-1", False, db_path) == 3
    assert quota.consume("dev-1", False, db_path)[0] is True


def test_daily_limit_reflects_premium_state(tight_limits):
    assert quota.daily_limit(False) == 3
    assert quota.daily_limit(True) == 5


# ─── Rate limiter ─────────────────────────────────────────────────────────────

def test_rate_limiter_allows_up_to_the_cap():
    limiter = quota.RateLimiter(max_requests=3, window_seconds=60)
    assert [limiter.allow("ip", now=0) for _ in range(3)] == [True] * 3
    assert limiter.allow("ip", now=0) is False


def test_rate_limiter_window_slides():
    limiter = quota.RateLimiter(max_requests=2, window_seconds=60)
    limiter.allow("ip", now=0)
    limiter.allow("ip", now=10)
    assert limiter.allow("ip", now=20) is False
    # The first hit ages out once the window has passed.
    assert limiter.allow("ip", now=61) is True


def test_rate_limiter_keys_are_independent():
    limiter = quota.RateLimiter(max_requests=1, window_seconds=60)
    assert limiter.allow("ip-a", now=0) is True
    assert limiter.allow("ip-a", now=0) is False
    assert limiter.allow("ip-b", now=0) is True
