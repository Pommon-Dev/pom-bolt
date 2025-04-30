export type DebugLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
import { Chalk } from 'chalk';

const chalk = new Chalk({ level: 3 });

type LoggerFunction = (...messages: any[]) => void;

interface Logger {
  trace: LoggerFunction;
  debug: LoggerFunction;
  info: LoggerFunction;
  warn: LoggerFunction;
  error: LoggerFunction;
  setLevel: (level: DebugLevel) => void;
}

// Default log level based on environment
let currentLevel: DebugLevel = (import.meta.env.VITE_LOG_LEVEL ?? import.meta.env.DEV) ? 'info' : 'warn';

// Rate limiting settings for logs
const LOG_RATE_LIMIT_MS = 1000; // 1 second between identical logs
const MAX_LOGS_PER_SECOND = 10; // Maximum logs per second

// Keep track of recent logs to prevent repetition
const recentLogs = new Map<string, number>();
let logCountInLastSecond = 0;
let lastLogResetTime = Date.now();

// Function to check if we should allow this log
function shouldAllowLog(level: DebugLevel, scope: string | undefined, message: string): boolean {
  // Always allow error logs
  if (level === 'error') return true;
  
  const now = Date.now();
  
  // Reset log count if more than a second has passed
  if (now - lastLogResetTime > 1000) {
    logCountInLastSecond = 0;
    lastLogResetTime = now;
  }
  
  // Check if we've exceeded the rate limit
  if (logCountInLastSecond >= MAX_LOGS_PER_SECOND) {
    return false;
  }
  
  // Increment log count
  logCountInLastSecond++;
  
  // For rate limiting repeated logs
  const key = `${level}:${scope}:${message}`;
  const lastLogTime = recentLogs.get(key) || 0;
  
  // If this exact log was output recently, skip it
  if (now - lastLogTime < LOG_RATE_LIMIT_MS) {
    return false;
  }
  
  // Update the last log time for this message
  recentLogs.set(key, now);
  
  // Clean up old entries periodically
  if (recentLogs.size > 100) {
    const oldEntries = [...recentLogs.entries()]
      .filter(([_, timestamp]) => now - timestamp > LOG_RATE_LIMIT_MS * 5);
    
    for (const [key] of oldEntries) {
      recentLogs.delete(key);
    }
  }
  
  return true;
}

export const logger: Logger = {
  trace: (...messages: any[]) => log('trace', undefined, messages),
  debug: (...messages: any[]) => log('debug', undefined, messages),
  info: (...messages: any[]) => log('info', undefined, messages),
  warn: (...messages: any[]) => log('warn', undefined, messages),
  error: (...messages: any[]) => log('error', undefined, messages),
  setLevel,
};

export function createScopedLogger(scope: string): Logger {
  return {
    trace: (...messages: any[]) => log('trace', scope, messages),
    debug: (...messages: any[]) => log('debug', scope, messages),
    info: (...messages: any[]) => log('info', scope, messages),
    warn: (...messages: any[]) => log('warn', scope, messages),
    error: (...messages: any[]) => log('error', scope, messages),
    setLevel,
  };
}

function setLevel(level: DebugLevel) {
  if ((level === 'trace' || level === 'debug') && import.meta.env.PROD) {
    return;
  }

  currentLevel = level;
}

function log(level: DebugLevel, scope: string | undefined, messages: any[]) {
  const levelOrder: DebugLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

  // Skip logs below the current level
  if (levelOrder.indexOf(level) < levelOrder.indexOf(currentLevel)) {
    return;
  }

  const allMessages = messages.reduce((acc, current) => {
    if (acc.endsWith('\n')) {
      return acc + current;
    }

    if (!acc) {
      return current;
    }

    return `${acc} ${current}`;
  }, '');
  
  // Check if we should allow this log based on rate limiting
  if (!shouldAllowLog(level, scope, String(allMessages))) {
    return;
  }

  const labelBackgroundColor = getColorForLevel(level);
  const labelTextColor = level === 'warn' ? '#000000' : '#FFFFFF';

  const labelStyles = getLabelStyles(labelBackgroundColor, labelTextColor);
  const scopeStyles = getLabelStyles('#77828D', 'white');

  const styles = [labelStyles];

  if (typeof scope === 'string') {
    styles.push('', scopeStyles);
  }

  let labelText = formatText(` ${level.toUpperCase()} `, labelTextColor, labelBackgroundColor);

  if (scope) {
    labelText = `${labelText} ${formatText(` ${scope} `, '#FFFFFF', '77828D')}`;
  }

  if (typeof window !== 'undefined') {
    console.log(`%c${level.toUpperCase()}${scope ? `%c %c${scope}` : ''}`, ...styles, allMessages);
  } else {
    console.log(`${labelText}`, allMessages);
  }
}

function formatText(text: string, color: string, bg: string) {
  return chalk.bgHex(bg)(chalk.hex(color)(text));
}

function getLabelStyles(color: string, textColor: string) {
  return `background-color: ${color}; color: white; border: 4px solid ${color}; color: ${textColor};`;
}

function getColorForLevel(level: DebugLevel): string {
  switch (level) {
    case 'trace':
    case 'debug': {
      return '#77828D';
    }
    case 'info': {
      return '#1389FD';
    }
    case 'warn': {
      return '#FFDB6C';
    }
    case 'error': {
      return '#EE4744';
    }
    default: {
      return '#000000';
    }
  }
}

export const renderLogger = createScopedLogger('Render');
