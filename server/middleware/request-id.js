import { randomUUID } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = UUID_RE.test(incoming) ? incoming : randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
