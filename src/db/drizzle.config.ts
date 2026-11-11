import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST || 'localhost';
const sqlPort = process.env.SQL_PORT ? parseInt(process.env.SQL_PORT, 10) : 5432;
const sqlDbName = process.env.SQL_DB_NAME || 'inventory';
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || 'postgres';
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || 'postgres';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (connectionString) {
  console.log('Using DATABASE_URL for database connection.');
} else {
  console.log(`Using database: ${sqlDbName} on ${sqlHost}:${sqlPort} with user: ${user}`);
}

const isLocal = connectionString
  ? connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
  : (sqlHost === 'localhost' || sqlHost === '127.0.0.1');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: connectionString
    ? {
        url: connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      }
    : {
        host: sqlHost,
        port: sqlPort,
        user: user,
        password: password,
        database: sqlDbName,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      },
  verbose: true,
});
