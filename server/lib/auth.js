import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters long.');
}
const JWT_ISSUER = process.env.JWT_ISSUER || 'flight-suite';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'flight-suite-web';
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(payload) {
  return jwt.sign(payload, SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomUUID()
  });
}

export function signRefreshToken(payload) {
  return jwt.sign({ ...payload, typ: 'refresh' }, SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomUUID()
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  });
  if (payload?.typ !== 'refresh') throw new Error('Invalid refresh token type.');
  return payload;
}
