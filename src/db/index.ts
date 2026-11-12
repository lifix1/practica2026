import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _pgliteClient: PGlite | undefined;
  var _dbInstance: any;
}

// Determine if we should connect to an external PostgreSQL database
// Cloud SQL uses Unix socket (/cloudsql/...) or real external DATABASE_URL
const hasExternalPostgres = () => {
  const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (connStr && !connStr.includes('localhost') && !connStr.includes('127.0.0.1')) {
    return true;
  }
  if (process.env.SQL_HOST && process.env.SQL_HOST.startsWith('/cloudsql/')) {
    return true;
  }
  if (
    process.env.SQL_HOST &&
    process.env.SQL_HOST !== 'localhost' &&
    process.env.SQL_HOST !== '127.0.0.1' &&
    process.env.SQL_USER &&
    process.env.SQL_PASSWORD
  ) {
    return true;
  }
  return false;
};

export const createPool = () => {
  if (!global._postgresPool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    const isLocal = connectionString
      ? connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      : process.env.SQL_HOST === 'localhost' || process.env.SQL_HOST === '127.0.0.1';

    const isSsl = process.env.SQL_SSL === 'false' ? false : (!isLocal || process.env.SQL_SSL === 'true');

    const commonConfig = {
      max: 10,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    };

    const poolConfig = connectionString
      ? {
          connectionString,
          ssl: isSsl ? { rejectUnauthorized: false } : undefined,
          ...commonConfig,
        }
      : {
          host: process.env.SQL_HOST || 'localhost',
          port: process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432,
          user: process.env.SQL_USER || 'postgres',
          password: process.env.SQL_PASSWORD || 'postgres',
          database: process.env.SQL_DB_NAME || 'inventory',
          ssl: process.env.SQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
          ...commonConfig,
        };

    global._postgresPool = new Pool(poolConfig);

    global._postgresPool.on('error', (err: any) => {
      const msg = err?.message || String(err);
      if (
        msg.includes('Connection terminated') ||
        msg.includes('ECONNRESET') ||
        err?.code === '57P01' ||
        err?.code === 'ECONNRESET'
      ) {
        return;
      }
      console.warn('PostgreSQL pool notice:', err?.message || err);
    });
  }
  return global._postgresPool;
};

// Initialize database instance (PGlite by default in container, or node-postgres with Cloud SQL)
export function initDatabase() {
  if (global._dbInstance) {
    return global._dbInstance;
  }

  if (hasExternalPostgres()) {
    try {
      console.log('Connecting to external PostgreSQL database...');
      const pool = createPool();
      global._dbInstance = drizzleNodePg(pool, { schema });
      return global._dbInstance;
    } catch (err) {
      console.warn('Failed to connect to external Postgres, falling back to embedded PGlite:', err);
    }
  }

  console.log('Starting embedded PostgreSQL 16 (PGlite in-memory engine)...');
  if (!global._pgliteClient) {
    global._pgliteClient = new PGlite();
  }
  global._dbInstance = drizzlePglite(global._pgliteClient, { schema });
  return global._dbInstance;
}

export const db = initDatabase();
