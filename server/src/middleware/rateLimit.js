/**
 * Tiny in-memory, per-key sliding-window rate limiter. No external dependency.
 * Good enough for a single-process app; swap for a shared store if you scale out.
 *
 * Sliding window (timestamps of recent hits) rather than fixed buckets, so a
 * caller can't fire 2x the limit across a window boundary.
 *
 * The key defaults to `req.ip`, which is only trustworthy when Express
 * `trust proxy` is configured to match your actual proxy layer (see config.js /
 * index.js). Behind an unconfigured proxy every request shares one key.
 */
export function rateLimit({
  windowMs,
  max,
  message = "Too many requests. Please slow down.",
  key = (req) => req.ip || req.socket?.remoteAddress || "unknown",
}) {
  const hits = new Map(); // key -> number[] (hit timestamps, ascending)

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs);
  sweep.unref?.();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const k = key(req);

    const times = (hits.get(k) || []).filter((t) => t > cutoff);
    times.push(now);
    hits.set(k, times);

    const remaining = Math.max(0, max - times.length);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (times.length > max) {
      const oldest = times[0];
      res.setHeader("Retry-After", String(Math.ceil((oldest + windowMs - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
