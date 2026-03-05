export interface RuntimeLogger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function createConsoleLogger(): RuntimeLogger {
  return {
    debug: (...args: unknown[]) => {
      console.debug(...args);
    },
    info: (...args: unknown[]) => {
      console.log(...args);
    },
    warn: (...args: unknown[]) => {
      console.warn(...args);
    },
    error: (...args: unknown[]) => {
      console.error(...args);
    },
  };
}

let runtimeLogger: RuntimeLogger = createConsoleLogger();

export function getRuntimeLogger(): RuntimeLogger {
  return runtimeLogger;
}

export function setRuntimeLogger(logger: RuntimeLogger): void {
  runtimeLogger = logger;
}

export function resetRuntimeLogger(): void {
  runtimeLogger = createConsoleLogger();
}

export function createNoopRuntimeLogger(): RuntimeLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
