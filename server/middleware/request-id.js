import { nanoid } from 'nanoid';

export function requestIdMiddleware(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = incoming || nanoid();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
