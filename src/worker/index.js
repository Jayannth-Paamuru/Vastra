import { isValidSpaRoute } from '../shared/constants.js';
import { routeApiRequest } from './routes.js';
import { ValidationError } from './validation.js';

function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function hasFileExtension(pathname) {
  const lastSegment = pathname.split('/').pop() || '';
  return lastSegment.includes('.') && !lastSegment.startsWith('.');
}

function withNoCacheHtmlHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // 1. API Router wrapped in global try/catch
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await routeApiRequest(request, env, url);
      } catch (err) {
        if (err instanceof ValidationError) {
          return jsonError(err.message, err.status || 400);
        }
        if (err instanceof SyntaxError) {
          return jsonError('Invalid JSON request payload.', 400);
        }
        return jsonError('An unexpected server error occurred.', 500);
      }
    }

    // 2. Non-API static assets & SPA routing with strict 404 interception
    if (!env.ASSETS) {
      return new Response('Not Found', { status: 404 });
    }

    // 2a. Explicit SPA routes -> fetch '/' from ASSETS (avoids Cloudflare's /index.html -> / 308 redirect loop)
    if (isValidSpaRoute(pathname)) {
      const rootUrl = new URL('/', url.origin);
      const htmlRes = await env.ASSETS.fetch(
        new Request(rootUrl.toString(), {
          method: 'GET',
          headers: request.headers
        })
      );
      return withNoCacheHtmlHeaders(htmlRes);
    }

    // 2b. Extensionless unknown paths -> real 404 (never silently serve index.html)
    if (!hasFileExtension(pathname)) {
      return new Response('404 Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }

    // 2c. File-like requests (/assets/app.js, /manifest.webmanifest, /sw.js, /icons/*.png)
    const assetRes = await env.ASSETS.fetch(request);
    const contentType = (assetRes.headers.get('Content-Type') || '').toLowerCase();

    // Intercept Cloudflare Pages SPA fallback returning index.html for missing non-HTML assets
    if (!pathname.endsWith('.html') && contentType.includes('text/html')) {
      return new Response('404 Asset Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }

    if (pathname.endsWith('.html')) {
      return withNoCacheHtmlHeaders(assetRes);
    }

    if (pathname === '/sw.js') {
      const headers = new Headers(assetRes.headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers
      });
    }

    return assetRes;
  }
};
