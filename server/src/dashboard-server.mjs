
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchBoardHealth } from './tools/board-health.mjs';
import { summarizeBoard } from './board-health.mjs';
import { logRequestError } from './utils/errors.mjs';

const host = '127.0.0.1';
const port = Number(process.env.BOARD_DASHBOARD_PORT || 8790);

const API_BASE = '/api';

// Route table: path -> how to turn the board analysis into the response body.
const API_ROUTES = {
  [`${API_BASE}/health`]: analysis => analysis,
  [`${API_BASE}/summary`]: summarizeBoard
};

const dashboardFile = name =>
  fileURLToPath(new URL(`../dashboard/${name}`, import.meta.url));

// Static dashboard assets served next to the page, keyed by URL path.
const ASSETS = {
  '/dashboard.js': {
    file: dashboardFile('dashboard.js'),
    type: 'text/javascript; charset=utf-8'
  }
};

const htmlPath = dashboardFile('index.html');

const json = (res, code, payload) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(payload));
};

export function createDashboardServer({
  analyze = fetchBoardHealth,
  page = () => readFile(htmlPath),
  assets = ASSETS
} = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);

      if (req.method !== 'GET') {
        return json(res, 405, {
          error: 'Method not allowed'
        });
      }

      if (url.pathname === '/') {
        const content = await page();

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "connect-src 'self'; " +
            "object-src 'none'; " +
            "base-uri 'none'"
        });

        return res.end(content);
      }

      const asset = assets[url.pathname];

      if (asset) {
        res.writeHead(200, {
          'Content-Type': asset.type,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });

        return res.end(await readFile(asset.file));
      }

      const toBody = API_ROUTES[url.pathname];

      if (toBody) {
        const analysis = await analyze({
          includeHistory: false
        });

        return json(res, 200, toBody(analysis));
      }

      return json(res, 404, {
        error: 'Not found'
      });

    } catch (err) {
      logRequestError('Dashboard request', err);

      if (!res.headersSent) {
        return json(res, 502, {
          error:
            'Unable to load board metrics. ' +
            'Check Trello environment configuration and network access.'
        });
      }

      res.end();
    }
  });
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(`file://${process.argv[1]}`))
) {
  createDashboardServer().listen(port, host, () => {
    console.log(
      `Read-only Board Health dashboard: http://${host}:${port}/`
    );
  });
}
