import serverless from 'serverless-http';
import { app } from '../../dist/server.mjs';

// Serverless handler for Netlify Functions
// Wraps Express app to handle /api/* and /q/* routes on Netlify
export const handler = serverless(app);