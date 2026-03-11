/**
 * AlliGo - Configuration Module
 * Centralized configuration with environment variable support
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

// Load .env file if it exists
function loadEnv() {
  try {
    const envPath = join(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      content.split("\n").forEach((line: string) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          const value = valueParts.join("=").replace(/^["']|["']$/g, "");
          if (key && value && !process.env[key]) {
            process.env[key] = value;
          }
        }
      });
    }
  } catch (e) {
    // .env file doesn't exist or can't be read, that's OK
  }
}

loadEnv();

export interface Config {
  // Server
  port: number;
  nodeEnv: "development" | "production" | "test";
  host: string;

  // Database
  databasePath: string;

  // Auth
  adminApiKey: string;
  defaultReadKey: string;
  jwtSecret: string;

  // Rate Limiting
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;

  // External Services
  braveApiKey?: string;

  // Feature Flags
  enableIngestion: boolean;
  enableDashboard: boolean;
}

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultValue;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.toLowerCase() === "true" || val === "1";
}

export const config: Config = {
  // Server
  port: getEnvNumber("PORT", 3399),
  nodeEnv: (getEnv("NODE_ENV", "development") as Config["nodeEnv"]),
  host: getEnv("HOST", "0.0.0.0"),

  // Database
  databasePath: getEnv("DATABASE_PATH", "./data/alligo.db"),

  // Auth - Use secure defaults for dev, require in production
  adminApiKey: getEnv("ADMIN_API_KEY", "alligo_admin_dev_key"),
  defaultReadKey: getEnv("DEFAULT_READ_KEY", "alligo_read_dev_key"),
  jwtSecret: getEnv("JWT_SECRET", "dev_jwt_secret_change_in_prod"),

  // Rate Limiting
  rateLimitWindowMs: getEnvNumber("RATE_LIMIT_WINDOW_MS", 60000),
  rateLimitMaxRequests: getEnvNumber("RATE_LIMIT_MAX_REQUESTS", 100),

  // External Services
  braveApiKey: getEnv("BRAVE_API_KEY", "") || undefined,

  // Feature Flags
  enableIngestion: getEnvBool("ENABLE_INGESTION", true),
  enableDashboard: getEnvBool("ENABLE_DASHBOARD", true),
};

// Ensure database directory exists
export function ensureDatabaseDir(): void {
  const dbDir = dirname(config.databasePath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created database directory: ${dbDir}`);
  }
}

// Validate configuration
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.nodeEnv === "production") {
    if (!config.adminApiKey || config.adminApiKey.includes("dev") || config.adminApiKey === "alligo_admin_dev_key") {
      errors.push("ADMIN_API_KEY must be set to a secure value in production");
    }
    if (!config.jwtSecret || config.jwtSecret.includes("dev")) {
      errors.push("JWT_SECRET must be set to a secure value in production");
    }
  }

  if (config.port < 1 || config.port > 65535) {
    errors.push("PORT must be between 1 and 65535");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Print configuration (safe for logs)
export function printConfig(): void {
  console.log("\n📋 AlliGo Configuration:");
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Database: ${config.databasePath}`);
  console.log(`   Rate Limit: ${config.rateLimitMaxRequests} req/${config.rateLimitWindowMs}ms`);
  console.log(`   Admin Key: ${config.adminApiKey ? "✓ configured" : "✗ not set"}`);
  console.log(`   Dashboard: ${config.enableDashboard ? "✓ enabled" : "✗ disabled"}`);
  console.log("");
}

export default config;
