#!/usr/bin/env bun
/**
 * AlliGo - Quick Start Script
 * Sets up environment and starts the server
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

console.log("🛡️ AlliGo Quick Start\n");

// Check for .env file
const envPath = join(process.cwd(), ".env");
if (!existsSync(envPath)) {
  console.log("📝 Creating .env file...");
  const devEnv = `# AlliGo Development Environment
# Generated ${new Date().toISOString()}

# Server
PORT=3399
NODE_ENV=development

# Database
DATABASE_PATH=./data/alligo.db

# API Keys (change these in production!)
ADMIN_API_KEY=alligo_admin_dev_key
DEFAULT_READ_KEY=alligo_read_dev_key
JWT_SECRET=dev_jwt_secret_change_in_production

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
`;
  writeFileSync(envPath, devEnv);
  console.log("✅ .env created with development defaults\n");
}

// Ensure data directory exists
const dataDir = join(process.cwd(), "data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log("📁 Created data directory\n");
}

console.log("🚀 Starting AlliGo server...\n");

// Import and run server
import("./src/api/server.ts");
