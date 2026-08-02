// Shared throttling for unauthenticated endpoints.
//
// Held in memory rather than a store: these windows are minutes long, so losing
// them on restart is acceptable, and keeping them out of the JSON stores avoids
// a write on every sign-in attempt. If the platform is ever run multi-instance
// this needs to move to shared state, because each instance counts separately.

const buckets = new Map();

function prune(now) {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

/**
 * Count one attempt against `key`. Returns { allowed, remaining, retryAfterMs }.
 * Callers decide what to do when `allowed` is false — for anti-enumeration
 * surfaces that usually means behaving exactly as if it had succeeded.
 */
function consume(key, { limit = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  prune(now);

  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  entry.count += 1;
  const allowed = entry.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - entry.count),
    retryAfterMs: allowed ? 0 : entry.resetAt - now
  };
}

/** Clear a key after a legitimate success, so one good attempt frees the budget. */
function reset(key) {
  buckets.delete(key);
}

/** Test seam: drop every window. */
function resetAll() {
  buckets.clear();
}

module.exports = { consume, reset, resetAll };
