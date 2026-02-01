/**
 * Logger - Structured logging with automatic caller detection
 *
 * Pino-based logger with custom caller information automatically injected into
 * every log entry. Detects calling file, function, and line number via stack
 * trace analysis. Supports PM2 mode (plain JSON) and dev mode (colorized).
 *
 * Log format: [file:function:line] message. Filters internal files and node_modules
 * from caller detection to surface actual application code.
 */

/// @vitest-ignore
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, resolve, relative } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root directory (2 levels up from utils/)
const projectRoot = resolve(__dirname, '..', '..');

/**
 * Custom caller detection function
 */
function getCallerInfo(): string {
    const originalFunc = Error.prepareStackTrace;
    let callerfile;
    let callerline;
    let callerfunc;

    try {
        const err = new Error();
        let currentfile;

        Error.prepareStackTrace = function (err, stack) { return stack; };

        currentfile = (err.stack as any)?.[0]?.getFileName();

        // Find the first frame that's not this file or internal modules
        for (let i = 0; i < (err.stack as any)?.length; i++) {
            const frame = (err.stack as any)[i];
            const filename = frame.getFileName();

            // Skip internal files and focus on actual user code
            if (filename &&
                filename !== currentfile &&
                !filename.includes('node_modules') &&
                !filename.includes('pino') &&
                !filename.includes('node:internal') &&
                !filename.includes('<anonymous>') &&
                !filename.includes('utils/logger.')) { // More specific check for logger files

                // Found a valid caller file
                callerfile = filename;
                callerline = frame.getLineNumber();
                callerfunc = frame.getFunctionName() || 'anonymous';
                break; // Take the first valid frame we find
            }
        }
    } catch (e) {
        // If caller detection fails, return unknown
        return 'unknown';
    } finally {
        Error.prepareStackTrace = originalFunc;
    }

    if (callerfile) {
        try {
            // Try to get relative path, fallback to just filename if that fails
            const relativePath = relative(projectRoot, callerfile);
            let filepart;

            if (relativePath && !relativePath.startsWith('..')) {
                filepart = relativePath.replace(/\\/g, '/').replace(/\.ts$/, '').replace(/^src\//, '');
            } else {
                // Use just the filename if we can't get a good relative path
                const parts = callerfile.split(/[\\\/]/);
                filepart = parts[parts.length - 1].replace(/\.ts$/, '').replace(/\.js$/, '');
            }

            return `${filepart}:${callerfunc}:${callerline}`;
        } catch (e) {
            return `${callerfile}:${callerfunc || 'anonymous'}:${callerline}`;
        }
    }

    return 'unknown';
}

/**
 * Detect if running under PM2
 */
const isRunningUnderPM2 = !!process.env.PM2_HOME || process.env.pm_id !== undefined;

/**
 * Logger setup with custom caller information
 * In PM2 mode: plain JSON output for PM2 log capture
 * In dev mode: colorized pretty output for local development
 */
const transport = pino.transport({
    target: 'pino-pretty',
    options: {
        colorize: !isRunningUnderPM2,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname,caller',
        messageFormat: '\x1b[33m[{caller}]\x1b[0m \x1b[36m{msg}\x1b[0m',
    },
    level: 'info'
});

const baseLogger = pino(
    {
        level: process.env.LOG_LEVEL || 'debug',
        timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport
);

// Create logger with custom caller detection
class LoggerWithCaller {
    private logger: pino.Logger;

    constructor(logger: pino.Logger) {
        this.logger = logger;
    }

    info(obj: any, msg?: string) {
        if (typeof obj === 'string') {
            // Handle logger.info("message") format
            return this.logger.info({ caller: getCallerInfo() }, obj);
        } else {
            // Handle logger.info({obj}, "message") format
            return this.logger.info({ ...obj, caller: getCallerInfo() }, msg);
        }
    }

    warn(obj: any, msg?: string) {
        if (typeof obj === 'string') {
            return this.logger.warn({ caller: getCallerInfo() }, obj);
        } else {
            return this.logger.warn({ ...obj, caller: getCallerInfo() }, msg);
        }
    }

    error(obj: any, msg?: string) {
        if (typeof obj === 'string') {
            return this.logger.error({ caller: getCallerInfo() }, obj);
        } else {
            return this.logger.error({ ...obj, caller: getCallerInfo() }, msg);
        }
    }

    debug(obj: any, msg?: string) {
        if (typeof obj === 'string') {
            return this.logger.debug({ caller: getCallerInfo() }, obj);
        } else {
            return this.logger.debug({ ...obj, caller: getCallerInfo() }, msg);
        }
    }

    trace(obj: any, msg?: string) {
        if (typeof obj === 'string') {
            return this.logger.trace({ caller: getCallerInfo() }, obj);
        } else {
            return this.logger.trace({ ...obj, caller: getCallerInfo() }, msg);
        }
    }

    fatal(obj: any, msg?: string) {
        if (typeof obj === 'string') {
            return this.logger.fatal({ caller: getCallerInfo() }, obj);
        } else {
            return this.logger.fatal({ ...obj, caller: getCallerInfo() }, msg);
        }
    }

    // Forward other methods
    child(options: any) {
        return new LoggerWithCaller(this.logger.child(options));
    }
}
const logger = new LoggerWithCaller(baseLogger);

export default logger;
