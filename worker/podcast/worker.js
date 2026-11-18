// Void Podcast — Worker entrypoint. workerd requires the entry module to
// export only handlers, so all logic and testable exports live in core.js.
// See README.md for the security rules and the owner deployment commands.
import { handleFeed, TIMEOUT_MS } from './core.js';

const rateBuckets = new Map();

export default {
  async fetch(request, env, ctx) {
    return handleFeed(request, {
      fetch: (u, init) => fetch(u, init),
      cache: caches.default,
      subtle: crypto.subtle,
      now: () => Date.now(),
      timeoutMs: TIMEOUT_MS,
      rateBuckets,
      waitUntil: p => { if (ctx && ctx.waitUntil) { ctx.waitUntil(p); } else { p.catch(() => {}); } }
    });
  }
};