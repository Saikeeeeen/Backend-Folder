#!/usr/bin/env node

/**
 * POS Backend Starter
 * Manages backend process for offline POS system
 * Runs Express server on port 3000
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MAX_STARTUP_WAIT = 10000; // 10 seconds

console.log('🚀 POS Backend Startup Manager');
console.log('================================\n');

// Check if port is already in use
const isPortInUse = (port) => {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(true)); // Port in use
    server.once('listening', () => {
      server.close();
      resolve(false); // Port available
    });
    server.listen(port);
  });
};

// Wait for server to be ready
const waitForServer = async (port, timeout = MAX_STARTUP_WAIT) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return true;
    } catch (e) {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const main = async () => {
  // Check if port is already in use
  const portInUse = await isPortInUse(PORT);
  if (portInUse) {
    console.log(`⚠️  Port ${PORT} already in use`);
    console.log('Attempting to connect to existing server...\n');

    const ready = await waitForServer(PORT, 3000);
    if (ready) {
      console.log(`✅ Connected to existing backend on http://localhost:${PORT}`);
      console.log('Server ready. Press Ctrl+C to exit.\n');
      // Keep process alive
      await new Promise(() => {});
      return;
    } else {
      console.log('❌ Could not connect to existing server');
      process.exit(1);
    }
  }

  console.log(`📦 Starting server on http://localhost:${PORT}...`);
  console.log('Initializing database...\n');

  // Start the server
  const server = spawn('node', [path.join(__dirname, 'src', 'server.js')], {
    cwd: __dirname,
    stdio: 'inherit',
  });

  // Wait for server to be ready
  const ready = await waitForServer(PORT);
  if (ready) {
    console.log(`\n✅ Backend ready on http://localhost:${PORT}`);
    console.log('Database initialized');
    console.log('\n📊 Quick test endpoints:');
    console.log(`   GET  http://localhost:${PORT}/api/health`);
    console.log(`   GET  http://localhost:${PORT}/api/bootstrap`);
    console.log(`   POST http://localhost:${PORT}/api/login`);
    console.log('\n🛑 Press Ctrl+C to stop server\n');
  } else {
    console.log('❌ Failed to start backend');
    server.kill();
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    server.kill();
    process.exit(0);
  });
};

main().catch((error) => {
  console.error('❌ Startup failed:', error.message);
  process.exit(1);
});
