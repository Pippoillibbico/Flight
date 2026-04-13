import { nanoid } from 'nanoid';

const REQUEST_ID_SAFE_RE = /^[a-zA-Z0-9\-_.]+$/;
const REQUEST_ID_MAX_LEN = 64;

export function requestIdMiddleware(req, res, next) {
  const raw = String(req.headers['x-request-id'] || '').trim();
  const isValid = raw.length > 0 && raw.length <= REQUEST_ID_MAX_LEN && REQUEST_ID_SAFE_RE.test(raw);
  const requestId = isValid ? raw : nanoid();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
