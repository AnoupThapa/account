import pino from 'pino';

/** Structured JSON logs (architecture.md §14). Never log passwords, tokens, or full account numbers. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: ['password', '*.password', 'req.headers.cookie', 'req.headers.authorization', '*.token', '*.refreshToken', '*.code'], censor: '[redacted]' },
  base: { service: 'ledgerpro-api' },
});
