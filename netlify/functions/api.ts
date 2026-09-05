/**
 * Netlify serverless function — wraps the Express app with serverless-http.
 *
 * This file is the entry point for ALL /api/* requests on Netlify.
 * Netlify routes /api/* to this function (see netlify.toml), which passes
 * the request to the Express app defined in server.ts.
 *
 * The Express app is imported from ../../server.ts. Netlify's bundler
 * (esbuild) bundles them together into a single function.
 *
 * Heavy endpoints (VGMdb/AniDB scraping, bulk-popular, dedup-sweep) will
 * timeout at Netlify's 10s limit. Run those locally with `npm start` —
 * see deploy/README.md for the hybrid setup.
 */

import serverlessHttp from 'serverless-http';
import { app } from '../../server';

// Wrap the Express app — serverless-http translates Netlify's event/context
// format into a standard Node.js HTTP request that Express can handle.
const handler = serverlessHttp(app);

export { handler };
