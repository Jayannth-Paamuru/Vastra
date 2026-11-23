import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(
  path.resolve(__dirname, '..', 'database', 'schema.sql'),
  'utf8'
);

export function createTestD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);

  const normalizeValue = (v) => (v === undefined ? null : v);

  return {
    prepare(sql) {
      let boundParams = [];
      return {
        bind(...params) {
          boundParams = params.map(normalizeValue);
          return this;
        },
        async first() {
          const stmt = db.prepare(sql);
          const row = stmt.get(...boundParams);
          return row === undefined ? null : row;
        },
        async all() {
          const stmt = db.prepare(sql);
          const results = stmt.all(...boundParams);
          return { success: true, results };
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...boundParams);
          return { success: true, meta: { changes: info.changes } };
        }
      };
    },
    close() {
      db.close();
    }
  };
}

export function createMockAssets() {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/index.html' || url.pathname === '/') {
        return new Response('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      if (url.pathname === '/manifest.webmanifest') {
        return new Response('{"name":"VastraLedger"}', {
          status: 200,
          headers: { 'Content-Type': 'application/manifest+json' }
        });
      }
      if (url.pathname === '/sw.js') {
        return new Response('// sw', {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' }
        });
      }
      // Simulate Cloudflare Pages SPA fallback returning index.html for missing assets
      return new Response('<!DOCTYPE html><html><body>fallback</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  };
}
