import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    const isLocal = connectionString
      ? connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      : (process.env.SQL_HOST === 'localhost' || process.env.SQL_HOST === '127.0.0.1');

    // Cloud providers (Neon, Supabase, Cloud SQL, etc.) require SSL unless connecting to local machine
    const isSsl = process.env.SQL_SSL === 'false' ? false : (!isLocal || process.env.SQL_SSL === 'true');

    const commonConfig = {
      max: 10,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 20000, // 20s allows cold-starting serverless databases like Neon to resume
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
      // In cloud and container environments (Cloud SQL, Cloud Run, Supabase, Neon),
      // the remote proxy or database server periodically closes idle TCP connections.
      // node-postgres handles this cleanly by removing the dead client from the pool
      // and creating a fresh connection on the next query.
      const msg = err?.message || String(err);
      if (
        msg.includes('Connection terminated') ||
        msg.includes('ECONNRESET') ||
        err?.code === '57P01' ||
        err?.code === 'ECONNRESET'
      ) {
        // Benign idle disconnect handled automatically by pool
        return;
      }
      console.warn('PostgreSQL pool notice:', err?.message || err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();
export const db = drizzle(pool, { schema });
