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

// Wrapper to handle error logging more flexibly
export const logger = {
  info: (msg: string, ...args: any[]) => pinoLogger.info(msg, ...args),
  warn: (msg: string, ...args: any[]) => pinoLogger.warn(msg, ...args),
  error: (msg: string, error?: any) => {
    if (error) {
      pinoLogger.error(msg, error);
    } else {
      pinoLogger.error(msg);
    }
  },
  debug: (msg: string, ...args: any[]) => pinoLogger.debug(msg, ...args),
};

