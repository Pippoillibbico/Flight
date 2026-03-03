import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino(
  isProd
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        level: process.env.LOG_LEVEL || 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard'
          }
        }
      }
);

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const payload = {
      request_id: req.id || null,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2))
    };

    if (res.statusCode >= 500) {
      logger.error(payload, 'request_failed');
      return;
    }
    logger.info(payload, 'request_completed');
  });

  return next();
}
