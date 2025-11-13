#!/usr/bin/env node

/**
 * Test setup and teardown scripts for bundler tests
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BUNDLER_PORT = 3009;
const MOCK_BACKEND_PORT = 8000;
const TEST_TIMEOUT = 30000;

/**
 * Start a process and return a promise that resolves when it's ready
 */
function startProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Starting: ${command} ${args.join(' ')}`);
    
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    
    let output = '';
    let ready = false;
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      
      // Check for readiness indicators
      if (!ready && (
        output.includes('server listening') ||
        output.includes(`listening on port ${BUNDLER_PORT}`) ||
        output.includes('Server started')
      )) {
        ready = true;
        console.log(`✅ ${command} is ready`);
        resolve(proc);
      }
    });
    
    proc.stderr.on('data', (data) => {
      console.error(`${command} stderr:`, data.toString());
    });
    
    proc.on('error', (error) => {
      console.error(`Failed to start ${command}:`, error);
      reject(error);
    });
    
    proc.on('exit', (code) => {
      if (code !== 0 && !ready) {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
    
    // Timeout if process doesn't become ready
    setTimeout(() => {
      if (!ready) {
        proc.kill();
        reject(new Error(`${command} failed to start within timeout`));
      }
    }, TEST_TIMEOUT);
  });
}

/**
 * Check if a port is in use
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    
    server.listen(port, (err) => {
      if (err) {
        resolve(true);
      } else {
        server.once('close', () => resolve(false));
        server.close();
      }
    });
    
    server.on('error', () => resolve(true));
  });
}

/**
 * Wait for a port to be available or in use
 */
function waitForPort(port, inUse = true, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    
    const check = async () => {
      const portInUse = await isPortInUse(port);
      
      if (portInUse === inUse) {
        resolve();
      } else if (Date.now() - start > timeout) {
        reject(new Error(`Port ${port} ${inUse ? 'not in use' : 'still in use'} after timeout`));
      } else {
        setTimeout(check, 100);
      }
    };
    
    check();
  });
}

/**
 * Setup test environment
 */
async function setupTests() {
  console.log('🚀 Setting up test environment...');
  
  try {
    // Check if ports are available
    const bundlerPortInUse = await isPortInUse(BUNDLER_PORT);
    const backendPortInUse = await isPortInUse(MOCK_BACKEND_PORT);
    
    if (bundlerPortInUse) {
      console.log(`⚠️  Port ${BUNDLER_PORT} is in use - tests may use existing bundler instance`);
    }
    
    if (backendPortInUse) {
      console.log(`⚠️  Port ${MOCK_BACKEND_PORT} is in use - tests may use existing backend instance`);
    }
    
    // Create test logs directory
    const logsDir = path.join(__dirname, '..', '..', 'test-logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = process.env.TEST_VERBOSE ? 'info' : 'silent';
    process.env.BUNDLER_PORT = BUNDLER_PORT.toString();
    process.env.BACKEND_URL = `http://localhost:${MOCK_BACKEND_PORT}`;
    
    console.log('✅ Test environment setup complete');
    
  } catch (error) {
    console.error('❌ Failed to setup test environment:', error);
    process.exit(1);
  }
}

/**
 * Teardown test environment
 */
async function teardownTests() {
  console.log('🧹 Tearing down test environment...');
  
  try {
    // Kill any processes we started (if we tracked them)
    // This would be implemented if we were managing long-running processes
    
    // Clean up test environment variables
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.BUNDLER_PORT;
    delete process.env.BACKEND_URL;
    
    console.log('✅ Test environment teardown complete');
    
  } catch (error) {
    console.error('❌ Failed to teardown test environment:', error);
    process.exit(1);
  }
}

/**
 * Start bundler for integration tests
 */
async function startBundler() {
  console.log('🚀 Starting bundler for integration tests...');
  
  try {
    // Build the bundler first
    console.log('Building bundler...');
    await new Promise((resolve, reject) => {
      const build = spawn('npm', ['run', 'build'], {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..', '..')
      });
      
      build.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build failed with code ${code}`));
        }
      });
    });
    
    // Start the bundler server
    const bundlerProc = await startProcess('node', ['dist/src/server.js'], {
      cwd: path.join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PORT: BUNDLER_PORT.toString(),
        NODE_ENV: 'test'
      }
    });
    
    // Wait for port to be ready
    await waitForPort(BUNDLER_PORT, true);
    
    console.log('✅ Bundler started successfully');
    return bundlerProc;
    
  } catch (error) {
    console.error('❌ Failed to start bundler:', error);
    throw error;
  }
}

/**
 * Stop bundler
 */
function stopBundler(proc) {
  return new Promise((resolve) => {
    if (proc && !proc.killed) {
      proc.on('close', () => {
        console.log('✅ Bundler stopped');
        resolve();
      });
      proc.kill();
    } else {
      resolve();
    }
  });
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
      setupTests();
      break;
    case 'teardown':
      teardownTests();
      break;
    case 'start-bundler':
      startBundler().catch(() => process.exit(1));
      break;
    default:
      console.log('Usage: node setup.js <setup|teardown|start-bundler>');
      process.exit(1);
  }
}

module.exports = {
  setupTests,
  teardownTests,
  startBundler,
  stopBundler,
  isPortInUse,
  waitForPort
};