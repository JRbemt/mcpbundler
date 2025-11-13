/// @vitest-ignore
import pino from 'pino';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the project root directory (2 levels up from utils/)
const projectRoot = resolve(__dirname, '..', '..');

// log file path
const logsDir = join(__dirname, 'logs');
const logFile = join(logsDir, 'app.log');

if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
}

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
 * Logger setup with custom caller information
 */
const transport = pino.transport({
    targets: [
        {
            target: 'pino-pretty', // pretty print to console
            options: {
                colorize: true, // TODO:DISABLE on pm2 logs?
                translateTime: 'SYS:HH:MM:ss',
                ignore: 'pid,hostname,caller',
                messageFormat: '[{caller}] {msg}',
            },
            level: 'info'
        },
        {
            target: 'pino/file',   // raw JSON logs to file
            options: { destination: logFile },
            level: 'debug'
        }
    ]
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
//TODO: prototype overwrite, callsites package
const logger = new LoggerWithCaller(baseLogger);

export default logger;
