import pino from 'pino';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Flexible logger wrapper that handles various calling patterns
export const logger = {
  info: (msg: any, ...args: any[]) => pinoLogger.info(msg, ...args),
  warn: (msg: any, ...args: any[]) => pinoLogger.warn(msg, ...args),
  error: (msg: any, err?: any) => {
    if (err) {
      pinoLogger.error({ err }, msg);
    } else {
      pinoLogger.error(msg);
    }
  },
  debug: (msg: any, ...args: any[]) => pinoLogger.debug(msg, ...args),
  fatal: (msg: any, ...args: any[]) => pinoLogger.fatal(msg, ...args),
};

