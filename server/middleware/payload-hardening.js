function safePositiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasControlChars(value) {
  return /[\u0000-\u001f\u007f]/.test(String(value || ''));
}

export function safeJsonByteLength(input) {
  try {
    return Buffer.byteLength(JSON.stringify(input), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function analyzePayloadShape(
  input,
  {
    maxDepth = 6,
    maxNodes = 400,
    maxArrayLength = 120,
    maxObjectKeys = 120,
    maxStringLength = 4096,
    maxKeyLength = 96,
    rejectControlCharacters = true
  } = {}
) {
  const safeMaxDepth = safePositiveInt(maxDepth, 6, 1, 24);
  const safeMaxNodes = safePositiveInt(maxNodes, 400, 50, 20_000);
  const safeMaxArrayLength = safePositiveInt(maxArrayLength, 120, 1, 10_000);
  const safeMaxObjectKeys = safePositiveInt(maxObjectKeys, 120, 1, 10_000);
  const safeMaxStringLength = safePositiveInt(maxStringLength, 4096, 32, 100_000);
  const safeMaxKeyLength = safePositiveInt(maxKeyLength, 96, 8, 512);
  const stack = [{ value: input, depth: 0 }];
  let visited = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    visited += 1;
    if (visited > safeMaxNodes) return { ok: false, reason: 'payload_too_many_nodes' };
    if (depth > safeMaxDepth) return { ok: false, reason: 'payload_too_deep' };

    if (value == null) continue;
    if (typeof value === 'string') {
      if (value.length > safeMaxStringLength) return { ok: false, reason: 'payload_string_too_long' };
      if (rejectControlCharacters && hasControlChars(value)) return { ok: false, reason: 'payload_control_characters' };
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { ok: false, reason: 'payload_invalid_number' };
      continue;
    }
    if (typeof value === 'boolean') continue;

    if (Array.isArray(value)) {
      if (value.length > safeMaxArrayLength) return { ok: false, reason: 'payload_array_too_large' };
      for (let index = 0; index < value.length; index += 1) {
        stack.push({ value: value[index], depth: depth + 1 });
      }
      continue;
    }

    if (!isPlainObject(value)) return { ok: false, reason: 'payload_invalid_object_type' };
    const entries = Object.entries(value);
    if (entries.length > safeMaxObjectKeys) return { ok: false, reason: 'payload_too_many_object_keys' };
    for (const [key, child] of entries) {
      if (!key || key.length > safeMaxKeyLength) return { ok: false, reason: 'payload_invalid_key' };
      if (!/^[a-zA-Z0-9_.-]+$/.test(key)) return { ok: false, reason: 'payload_invalid_key' };
      stack.push({ value: child, depth: depth + 1 });
    }
  }

  return { ok: true };
}

export function createPayloadHardeningMiddleware({
  maxBytes = 64 * 1024,
  maxDepth = 6,
  maxNodes = 400,
  maxArrayLength = 120,
  maxObjectKeys = 120,
  maxStringLength = 4096,
  maxKeyLength = 96,
  rejectControlCharacters = true,
  methods = ['POST', 'PUT', 'PATCH', 'DELETE'],
  onReject
} = {}) {
  const safeMaxBytes = safePositiveInt(maxBytes, 64 * 1024, 1024, 1024 * 1024);
  const allowedMethods = new Set(
    (Array.isArray(methods) ? methods : ['POST', 'PUT', 'PATCH', 'DELETE']).map((value) => String(value || '').toUpperCase())
  );

  return function payloadHardeningMiddleware(req, res, next) {
    const method = String(req.method || '').toUpperCase();
    if (!allowedMethods.has(method)) return next();
    if (req.body == null) return next();
    if (Buffer.isBuffer(req.body)) return next();

    const bodySize = safeJsonByteLength(req.body);
    if (!Number.isFinite(bodySize) || bodySize > safeMaxBytes) {
      if (typeof onReject === 'function') return onReject(req, res, 'payload_too_large', { bodySize, maxBytes: safeMaxBytes });
      return res.status(413).json({ error: 'payload_too_large' });
    }

    const result = analyzePayloadShape(req.body, {
      maxDepth,
      maxNodes,
      maxArrayLength,
      maxObjectKeys,
      maxStringLength,
      maxKeyLength,
      rejectControlCharacters
    });
    if (!result.ok) {
      if (typeof onReject === 'function') return onReject(req, res, 'invalid_payload', result);
      return res.status(400).json({ error: 'invalid_payload' });
    }

    return next();
  };
}
