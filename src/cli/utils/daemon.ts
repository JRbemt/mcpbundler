import fs from 'fs';
import path from 'path';
import os from 'os';
import pm2 from 'pm2';
import { fileURLToPath } from 'url';

const DAEMON_DIR = path.join(os.homedir(), '.mcpbundler');
const LOG_DIR = path.join(DAEMON_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bundler.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'bundler.error.log');
const PM2_APP_NAME = 'mcpbundler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
}

/**
 * Ensure daemon directory exists
 */
export function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Generic helper to execute PM2 operations with automatic connection management
 */
async function withPM2Connection<T>(operation: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });

  try {
    return await operation();
  } finally {
    // Always disconnect, even on error
    setImmediate(() => {
      try {
        pm2.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    });
  }
}

/**
 * Promisify PM2 describe operation
 */
function describePM2Process(name: string): Promise<pm2.ProcessDescription[]> {
  return new Promise((resolve, reject) => {
    pm2.describe(name, (err, list) => {
      if (err) reject(err);
      else resolve(list || []);
    });
  });
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  try {
    return await withPM2Connection(async () => {
      const processList = await describePM2Process(PM2_APP_NAME);

      if (processList.length === 0) {
        return { running: false };
      }

      const proc = processList[0];
      const isRunning = proc.pm2_env?.status === 'online';

      if (!isRunning) {
        return { running: false };
      }

      // Extract port from environment variables
      const pm2Env = proc.pm2_env as any;
      const port = pm2Env?.env?.PORT
        ? parseInt(pm2Env.env.PORT as string, 10)
        : undefined;

      return {
        running: true,
        pid: proc.pid,
        port,
      };
    });
  } catch {
    // PM2 not running or connection failed
    return { running: false };
  }
}

/**
 * Start daemon using PM2
 */
export async function startDaemon(port: number, databaseUrl?: string): Promise<DaemonStatus> {
  ensureDaemonDir();

  return withPM2Connection(async () => {
    // Prepare environment - filter out undefined values
    const env = Object.entries(process.env)
      .filter(([_, value]) => value !== undefined)
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value as string }), {
        PORT: port.toString(),
        ...(databaseUrl && { DATABASE_URL: databaseUrl }),
      });

    const scriptPath = path.join(__dirname, '../../main.js');

    // PM2 start options
    const options: pm2.StartOptions = {
      name: PM2_APP_NAME,
      script: scriptPath,
      env,
      output: LOG_FILE,
      error: ERROR_LOG_FILE,
      autorestart: true,
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 4000,
      kill_timeout: 5000,
    };

    // Start the process
    await new Promise<void>((resolve, reject) => {
      pm2.start(options, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Query the process to get the actual system PID
    const processList = await describePM2Process(PM2_APP_NAME);

    if (processList.length === 0) {
      throw new Error('Failed to start daemon: process not found after start');
    }

    return {
      running: true,
      pid: processList[0].pid,
      port,
    };
  });
}

/**
 * Stop daemon using PM2
 */
export async function stopDaemon(): Promise<boolean> {
  try {
    return await withPM2Connection(async () => {
      // Stop the process
      await new Promise<void>((resolve, reject) => {
        pm2.stop(PM2_APP_NAME, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Delete the process from PM2 (ignore errors - stopped is what matters)
      await new Promise<void>((resolve) => {
        pm2.delete(PM2_APP_NAME, () => resolve());
      });

      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Get log file paths
 */
export function getLogPaths() {
  ensureDaemonDir();
  return {
    stdout: LOG_FILE,
    stderr: ERROR_LOG_FILE,
  };
}
