/* Void Signals — Phase B visual preview. Network isolation shim (isolated file).
 *
 * Injected at serve time before any production script. Every request that would
 * leave this preview origin is rewritten to the local simulated endpoint, so the
 * preview can never read or write production data, send a notification, or hit a
 * production write route. Production source files are not modified.
 */
(function () {
  'use strict';
  var ORIGIN = location.origin;
  var API = /^\/(tracks|letters|visitors|admin|podcast|signals|support|domains|invite|qr)(\/|$)/;
  var log = [];
  window.__VOID_PREVIEW__ = { isolated: true, simulated: true, intercepted: log, startedAt: Date.now() };
  try { window.__VOID_API_BASE__ = ORIGIN + '/__sim'; } catch (e) {}

  function redirect(u) {
    var s = String((u && u.url) || u || '');
    if (!s || s.indexOf('data:') === 0 || s.indexOf('blob:') === 0) return null;
    var x;
    try { x = new URL(s, ORIGIN); } catch (e) { return null; }
    if (x.origin === ORIGIN) return API.test(x.pathname) ? ORIGIN + '/__sim' + x.pathname + x.search : null;
    return ORIGIN + '/__sim' + x.pathname + x.search;
  }

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var target = redirect(input);
      if (!target) return nativeFetch(input, init);
      log.push({ url: String((input && input.url) || input), to: target, at: Date.now() });
      var req = (input && input.url) ? new Request(target, input) : target;
      return nativeFetch(req, init);
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var target = redirect(url);
    if (target) {
      log.push({ url: String(url), to: target, at: Date.now(), via: 'xhr' });
      arguments[1] = target;
    }
    return nativeOpen.apply(this, arguments);
  };

  if (navigator.sendBeacon) navigator.sendBeacon = function (u) { log.push({ url: String(u), blocked: 'beacon', at: Date.now() }); return true; };

  var NativeWS = window.WebSocket;
  if (NativeWS) {
    window.WebSocket = function (url, protocols) {
      var x;
      try { x = new URL(String(url), ORIGIN); } catch (e) { x = null; }
      if (x && x.origin !== ORIGIN) {
        log.push({ url: String(url), blocked: 'websocket', at: Date.now() });
        throw new Error('preview: remote WebSocket blocked');
      }
      return protocols === undefined ? new NativeWS(url) : new NativeWS(url, protocols);
    };
    window.WebSocket.prototype = NativeWS.prototype;
    window.WebSocket.CONNECTING = NativeWS.CONNECTING;
    window.WebSocket.OPEN = NativeWS.OPEN;
    window.WebSocket.CLOSING = NativeWS.CLOSING;
    window.WebSocket.CLOSED = NativeWS.CLOSED;
  }
})();