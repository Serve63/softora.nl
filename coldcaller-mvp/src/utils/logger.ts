export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
  child: (scope: string) => Logger;
}

function normalizeLevel(input: string | undefined): LogLevel {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

function toErrorMeta(meta: unknown): unknown {
  if (!(meta instanceof Error)) return meta;
  return {
    name: meta.name,
    message: meta.message,
    stack: meta.stack,
  };
}

export function createLogger(scope: string, configuredLevel?: string): Logger {
  const minLevel = normalizeLevel(configuredLevel);

  const log = (level: LogLevel, message: string, meta?: unknown) => {
    if (levelWeight[level] < levelWeight[minLevel]) return;

    const line = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...(meta !== undefined ? { meta: toErrorMeta(meta) } : {}),
    };

    const output = JSON.stringify(line);
    if (level === 'error') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  };

  return {
    debug: (message, meta) => log('debug', message, meta),
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    child: (childScope: string) => createLogger(`${scope}:${childScope}`, minLevel),
  };
}
