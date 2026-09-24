// Per-process protection. Use a shared store for multiple API instances.
function rateLimit(max = 30, windowMs = 60000) {
  const buckets = new Map();
  const timer = setInterval(() => {
    for (const [key, value] of buckets) if (value.until <= Date.now()) buckets.delete(key);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    const key = req.ip;
    let item = buckets.get(key);
    if (!item || item.until <= Date.now()) { item = { count: 0, until: Date.now() + windowMs }; buckets.set(key, item); }
    if (++item.count > max) {
      res.set('Retry-After', String(Math.ceil((item.until - Date.now()) / 1000)));
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }
    next();
  };
}
module.exports = rateLimit;
