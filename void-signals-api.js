/* Void — Signals API client.
 *
 * One place that knows the shapes of /signals and /admin/signals: paths, snake_code
 * errors, unix-second timestamps, optimistic-conversion fields and the profile settings
 * allowlist. It never reads or stores a credential itself: callers hand it a transport.
 *
 *   var api = VoidSignalsApi.create(function (path, options) {
 *     return fetch(base + path, options).then(asResult);   // {status,data,network,timeout}
 *   });
 *   api.state().then(...)          // public, no credential
 *   api.admin.list({status:'active'}).then(...)   // admin, transport adds the credential
 */
(function (global) {
  'use strict';

  var LIMITS = {
    title: 120, body: 500, name: 64, actor: 32, bodyBytes: 8192,
    publicMax: 60, adminMax: 200, maxActive: 60,
    minLeadSec: 30, maxLifetimeSec: 31536000
  };

  var IMPORTANCES = ['ambient', 'important'];
  var CATEGORIES = ['general', 'release', 'event', 'milestone', 'maintenance'];
  var STATUSES = ['draft', 'scheduled', 'active', 'hidden', 'revoked', 'expired'];
  var METADATA_KEYS = ['lang', 'icon', 'tone', 'occasion'];

  /* action -> the status it asks for, plus what else the server expects */
  var ACTIONS = {
    publish: { target: 'active', label: 'Publish', needs: [] },
    schedule: { target: 'scheduled', label: 'Schedule', needs: ['scheduled_at'] },
    hide: { target: 'hidden', label: 'Hide', needs: [] },
    revoke: { target: 'revoked', label: 'Revoke', needs: [], terminal: true },
    reopen: { target: 'draft', label: 'Return to draft', needs: [] }
  };

  /* which actions a row in this status can attempt (server truth, mirrored for UX only) */
  var NEXT = {
    draft: ['schedule', 'publish', 'revoke'],
    scheduled: ['publish', 'reopen', 'revoke'],
    active: ['hide', 'revoke'],
    hidden: ['publish', 'revoke'],
    revoked: [],
    expired: ['reopen']
  };

  var SET_ENUMS = {
    preset: ['organic', 'constellation', 'circular', 'spiral', 'geometric', 'heart', 'star'],
    style: ['spark', 'point', 'bloom', 'hairline'],
    color: ['gold', 'silver', 'white', 'ember', 'ice'],
    motion: ['animated', 'static']
  };
  var SET_RANGES = {
    size: [0.5, 2.2, 1], brightness: [0.3, 1.6, 1], glow: [0, 2, 1], softness: [0, 1, 0],
    motionIntensity: [0, 1.6, 1], glowTransitionMs: [120, 2600, 900], drift: [0, 1.2, 0.35]
  };
  var SET_KEYS = ['preset', 'style', 'color', 'motion'].concat(Object.keys(SET_RANGES));
  var SET_DEFAULTS = {
    preset: 'organic', style: 'spark', color: 'gold', size: 1, brightness: 1, glow: 1,
    softness: 0, motion: 'animated', motionIntensity: 1, glowTransitionMs: 900, drift: 0.35
  };

  /* Operator-facing wording. Deliberately free of table names, SQL and internal state. */
  var ERRORS = {
    signals_unavailable: 'Signals storage is not reachable yet. The migration may not be applied on this worker.',
    method_not_allowed: 'That action is not allowed here.',
    not_found: 'Nothing at that address.',
    invalid_id: 'That message id is not valid.',
    profile_id_invalid: 'That profile id is not valid.',
    signal_not_found: 'This message no longer exists.',
    profile_not_found: 'This profile no longer exists.',
    message_not_available: 'This message is not visible right now.',
    title_required: 'A title is required.',
    title_too_long: 'The title is too long.',
    body_too_short: 'The message body needs at least 3 characters.',
    body_too_long: 'The message body is too long.',
    body_too_large: 'That message is too large to send.',
    markup_prohibited: 'Markup and control characters are not allowed in a signal.',
    link_prohibited: 'Links and domain names do not belong in a signal.',
    text_invalid: 'That text could not be accepted.',
    category_unknown: 'Pick one of the known categories.',
    importance_unknown: 'Importance is either ambient or important.',
    status_invalid: 'That starting status is not available.',
    status_requires_transition: 'Status changes go through an explicit action, not an edit.',
    scheduled_at_required: 'A scheduled message needs a publish time.',
    scheduled_at_in_past: 'The publish time is in the past or too soon (minimum 30 seconds ahead).',
    scheduled_at_too_far: 'That publish time is too far in the future.',
    scheduled_at_must_be_integer: 'The publish time could not be read.',
    expires_in_invalid: 'Lifetime must be between 1 minute and 1 year.',
    expires_in_past: 'The expiry time is in the past.',
    expires_at_too_far: 'The expiry time is too far in the future.',
    expires_at_must_be_integer: 'The expiry time could not be read.',
    expires_before_scheduled: 'A message cannot expire before it is due to appear.',
    already_expired: 'This message has already expired, so it cannot go live.',
    invalid_transition: 'That transition is not allowed from the message’s current status.',
    active_limit_reached: 'The galaxy already has the maximum number of live signals. Retire one first.',
    nothing_to_update: 'Nothing changed, so nothing was saved.',
    stale_snapshot: 'This row changed while you were looking at it. The view was refreshed.',
    stale_or_missing_profile: 'This profile changed while you were editing it. Reload it before saving.',
    confirmation_required: 'Type the confirmation phrase to continue.',
    delete_confirmation_required: 'Type the confirmation phrase to continue.',
    profile_in_use: 'This profile is still assigned or referenced by messages.',
    profile_not_active: 'This profile has no activated version yet, so it cannot be assigned.',
    version_not_found: 'That version does not exist for this profile.',
    version_required: 'Pick the version to restore.',
    profile_name_required: 'A profile needs a name.',
    profile_name_too_long: 'That profile name is too long.',
    settings_required: 'No settings were sent.',
    settings_must_be_object: 'Settings must be a list of values.',
    settings_too_large: 'Too many settings keys were sent at once.',
    setting_not_allowed: 'One of those settings is not part of the appearance model.',
    preset_invalid: 'That arrangement preset is not available.',
    style_invalid: 'That star style is not available.',
    color_invalid: 'That colour is not available.',
    motion_invalid: 'Motion is either animated or static.',
    size_must_be_number: 'Size must be a number.',
    brightness_must_be_number: 'Brightness must be a number.',
    glow_must_be_number: 'Glow must be a number.',
    softness_must_be_number: 'Softness must be a number.',
    motionIntensity_must_be_number: 'Motion intensity must be a number.',
    glowTransitionMs_must_be_number: 'Glow transition must be a number.',
    drift_must_be_number: 'Drift must be a number.',
    presentation_belongs_in_a_profile: 'Appearance lives in a profile, not in a message.',
    metadata_too_large: 'Too much extra data was attached to the message.',
    metadata_key_not_allowed: 'That message field is not one of the allowed extras.',
    actor_invalid: 'The author label is not valid.',
    scope_invalid: 'That assignment target is not recognised.',
    forbidden: 'The admin credential was refused for this request.',
    unauthorized: 'This request needs the admin credential.',
    rate_limited: 'Too many attempts. Wait before trying again.',
    unavailable: 'The worker could not complete the request right now.',
    network: 'The worker could not be reached.',
    timeout: 'The worker took too long to answer.',
    unexpected: 'The request failed.'
  };

  function messageFor(code, status) {
    if (code && ERRORS[code]) return ERRORS[code];
    if (status === 0) return ERRORS.network;
    if (status === 401) return ERRORS.unauthorized;
    if (status === 403) return ERRORS.forbidden;
    if (status === 404) return ERRORS.not_found;
    if (status === 409) return ERRORS.invalid_transition;
    if (status === 413) return ERRORS.body_too_large;
    if (status === 429) return ERRORS.rate_limited;
    if (status >= 500) return ERRORS.unavailable;
    return ERRORS.unexpected + ' (HTTP ' + status + ')';
  }

  /* Every call resolves to one of these two shapes; nothing rejects. */
  function fail(response, extra) {
    var status = response && response.status ? response.status : 0;
    var data = (response && response.data) || {};
    var code = data.error || (response && response.timeout ? 'timeout' : (response && response.network ? 'network' : ''));
    var out = {
      ok: false, status: status, code: code || 'unexpected',
      error: messageFor(code, status), allowed: data.allowed || null,
      current_version: typeof data.current_version === 'number' ? data.current_version : null,
      network: !!(response && response.network), timeout: !!(response && response.timeout)
    };
    if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k]; }
    return out;
  }

  function done(response, pick) {
    if (!response || response.status < 200 || response.status >= 300) return fail(response);
    var data = response.data || {};
    if (data.ok !== true) return fail(response);
    return { ok: true, status: response.status, data: pick ? pick(data) : data };
  }

  function toMs(seconds) {
    var n = Number(seconds);
    return isFinite(n) && n > 0 ? n * 1000 : null;
  }

  function toSeconds(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Math.round(Number(value));
    return isFinite(n) && n > 0 ? n : null;
  }

  /* datetime-local gives local wall time; the API speaks unix seconds in any zone. */
  function inputToSeconds(raw) {
    if (!raw) return null;
    var parsed = Date.parse(String(raw));
    if (!isFinite(parsed)) return null;
    return Math.round(parsed / 1000);
  }

  function secondsToInput(seconds) {
    var ms = toMs(seconds);
    if (!ms) return '';
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }

  function clampSettings(input) {
    var src = input || {};
    var out = {};
    for (var i = 0; i < SET_KEYS.length; i++) {
      var key = SET_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      var allowed = SET_ENUMS[key];
      if (allowed) {
        var v = String(src[key] || '').trim().toLowerCase();
        if (allowed.indexOf(v) !== -1) out[key] = v;
        continue;
      }
      var range = SET_RANGES[key];
      var n = Number(src[key]);
      if (!isFinite(n)) continue;
      n = Math.min(range[1], Math.max(range[0], n));
      out[key] = key === 'glowTransitionMs' ? Math.round(n) : Math.round(n * 1000) / 1000;
    }
    return out;
  }

  function fullSettings(input) {
    var clamped = clampSettings(input);
    for (var i = 0; i < SET_KEYS.length; i++) {
      var key = SET_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(clamped, key)) clamped[key] = SET_DEFAULTS[key];
    }
    return clamped;
  }

  function query(params) {
    var parts = [];
    for (var key in params) {
      if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
      var value = params[key];
      if (value === null || value === undefined || value === '') continue;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  function create(transport) {
    function call(path, options) { return transport(path, options || {}); }

    var publicApi = {
      health: function () {
        return call('/signals/version').then(function (r) {
          return done(r, function (d) { return { version: Number(d.version) || 0 }; });
        });
      },
      feed: function (limit) {
        return call('/signals/messages' + query({ limit: limit })).then(function (r) {
          return done(r, function (d) { return { version: d.version, messages: d.messages || [] }; });
        });
      },
      message: function (id) {
        return call('/signals/messages/' + encodeURIComponent(id)).then(function (r) {
          return done(r, function (d) { return d.message; });
        });
      },
      profile: function () {
        return call('/signals/profile').then(function (r) {
          return done(r, function (d) {
            return {
              version: d.version, server_time: d.server_time,
              profiles: d.profiles || {}, assignments: d.assignments || { global: null, byCategory: {}, byImportance: {} }
            };
          });
        });
      },
      state: function (limit) {
        return call('/signals/state' + query({ limit: limit })).then(function (r) {
          return done(r, function (d) {
            return {
              version: d.version, server_time: d.server_time, messages: d.messages || [],
              profiles: d.profiles || {}, assignments: d.assignments || { global: null, byCategory: {}, byImportance: {} }
            };
          });
        });
      }
    };

    publicApi.admin = {
      list: function (filters) {
        var p = filters || {};
        return call('/admin/signals/messages' + query({
          status: p.status, category: p.category, importance: p.importance,
          limit: p.limit, offset: p.offset
        })).then(function (r) {
          return done(r, function (d) {
            return {
              items: d.items || [], total: d.total || {}, limit: d.limit, offset: d.offset,
              version: d.version, server_time: d.server_time
            };
          });
        });
      },
      detail: function (id) {
        return call('/admin/signals/messages/' + encodeURIComponent(id)).then(function (r) {
          return done(r, function (d) {
            return {
              message: d.message, profile: d.profile || null,
              allowed: d.allowed_transitions || [], version: d.version, server_time: d.server_time
            };
          });
        });
      },
      create: function (payload) {
        return call('/admin/signals/messages', { method: 'POST', body: payload }).then(function (r) {
          return done(r, function (d) { return { message: d.message, version: d.version }; });
        });
      },
      update: function (id, patch) {
        return call('/admin/signals/messages/' + encodeURIComponent(id), { method: 'PUT', body: patch })
          .then(function (r) { return done(r, function (d) { return d.message; }); });
      },
      transition: function (id, action, extra) {
        var body = { action: action };
        var src = extra || {};
        if (src.scheduled_at !== undefined) body.scheduled_at = src.scheduled_at;
        if (src.expires_in !== undefined) body.expires_in = src.expires_in;
        if (src.expires_at !== undefined) body.expires_at = src.expires_at;
        if (src.expected_version !== undefined) body.expected_version = src.expected_version;
        if (src.created_by !== undefined) body.created_by = src.created_by;
        return call('/admin/signals/messages/' + encodeURIComponent(id) + '/transition',
          { method: 'POST', body: body }).then(function (r) {
            return done(r, function (d) { return { message: d.message, action: d.action, version: d.version }; });
          });
      },
      remove: function (id, confirmText, expectedVersion) {
        var body = { confirm: confirmText };
        if (expectedVersion !== undefined && expectedVersion !== null) body.expected_version = expectedVersion;
        return call('/admin/signals/messages/' + encodeURIComponent(id), { method: 'DELETE', body: body })
          .then(function (r) { return done(r, function (d) { return d; }); });
      },
      profiles: function () {
        return call('/admin/signals/profiles').then(function (r) {
          return done(r, function (d) { return { items: d.items || [], version: d.version }; });
        });
      },
      profile: function (id, wantVersions) {
        return call('/admin/signals/profiles/' + encodeURIComponent(id) + (wantVersions ? '/versions' : ''))
          .then(function (r) {
            return done(r, function (d) {
              return {
                profile: d.profile, active_settings: d.active_settings || null,
                draft_settings: d.draft_settings || null, versions: d.versions || [], version: d.version
              };
            });
          });
      },
      createProfile: function (payload) {
        return call('/admin/signals/profiles', { method: 'POST', body: payload }).then(function (r) {
          return done(r, function (d) { return { profile: d.profile, settings: d.settings }; });
        });
      },
      saveProfile: function (id, settings, options) {
        var opts = options || {};
        var body = { settings: fullSettings(settings) };
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.expected_version !== undefined && opts.expected_version !== null) {
          body.expected_version = opts.expected_version;
        }
        if (opts.created_by !== undefined) body.created_by = opts.created_by;
        return call('/admin/signals/profiles/' + encodeURIComponent(id), { method: 'PUT', body: body })
          .then(function (r) {
            return done(r, function (d) {
              return {
                profile: d.profile, saved_version: d.saved_version,
                active_version: d.active_version, published: d.published, settings: d.settings
              };
            });
          });
      },
      activateProfile: function (id, version, expectedVersion) {
        var body = {};
        if (version) body.version = version;
        if (expectedVersion !== undefined && expectedVersion !== null) body.expected_version = expectedVersion;
        return call('/admin/signals/profiles/' + encodeURIComponent(id) + '/activate', { method: 'POST', body: body })
          .then(function (r) {
            return done(r, function (d) {
              return {
                active_version: d.active_version, previous_active_version: d.previous_active_version,
                settings: d.settings, version: d.version
              };
            });
          });
      },
      restoreProfile: function (id, version, activate) {
        var body = { version: version, activate: !!activate };
        return call('/admin/signals/profiles/' + encodeURIComponent(id) + '/restore', { method: 'POST', body: body })
          .then(function (r) {
            return done(r, function (d) {
              return { profile: d.profile, restored_from: d.restored_from, active_version: d.active_version, settings: d.settings };
            });
          });
      },
      duplicateProfile: function (id, name) {
        var body = {};
        if (name) body.name = name;
        return call('/admin/signals/profiles/' + encodeURIComponent(id) + '/duplicate', { method: 'POST', body: body })
          .then(function (r) { return done(r, function (d) { return { profile: d.profile, copied_from: d.copied_from }; }); });
      },
      deleteProfile: function (id, confirmText) {
        return call('/admin/signals/profiles/' + encodeURIComponent(id), { method: 'DELETE', body: { confirm: confirmText } })
          .then(function (r) { return done(r, function (d) { return d; }); });
      },
      assignments: function () {
        return call('/admin/signals/assignments').then(function (r) {
          return done(r, function (d) { return { items: d.items || [], version: d.version }; });
        });
      },
      assign: function (scope, profileId) {
        return call('/admin/signals/assignments', { method: 'POST', body: { scope: scope, profile_id: profileId } })
          .then(function (r) { return done(r, function (d) { return d; }); });
      }
    };

    return publicApi;
  }

  /* Public-only client for the visitor layer: same paths, no credential ever sent. */
  /* Pages serves the app from minoodar.github.io, so a relative path would ask GitHub for
     /signals/* instead of the Worker. Same fallback order as void-letters-api.js: an explicit
     base (?local-api=1) wins, otherwise the deployed Worker origin. */
  var WORKER_BASE = 'https://void-galaxy-letters.minoodar.workers.dev';
  function createForPage() {
    var base = String(global.__VOID_API_BASE__ || WORKER_BASE).replace(/\/+$/, '');
    return create(function (path, options) {
      var init = { method: options.method || 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', mode: 'cors' };
      if (options.body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
      return global.fetch(base + path, init).then(function (response) {
        return response.text().then(function (raw) {
          var data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
          return { status: response.status, data: data, network: false, timeout: false };
        }, function () { return { status: 0, data: null, network: true, timeout: false }; });
      }, function () { return { status: 0, data: null, network: true, timeout: false }; });
    });
  }

  global.VoidSignalsApi = {
    create: create,
    forPage: createForPage,
    LIMITS: LIMITS,
    IMPORTANCES: IMPORTANCES,
    CATEGORIES: CATEGORIES,
    STATUSES: STATUSES,
    ACTIONS: ACTIONS,
    NEXT: NEXT,
    METADATA_KEYS: METADATA_KEYS,
    SETTING_KEYS: SET_KEYS,
    SETTING_ENUMS: SET_ENUMS,
    SETTING_RANGES: SET_RANGES,
    DEFAULTS: SET_DEFAULTS,
    ERRORS: ERRORS,
    messageFor: messageFor,
    clampSettings: clampSettings,
    fullSettings: fullSettings,
    secToMs: toMs,
    secToInput: secondsToInput,
    inputToSec: inputToSeconds
  };
})(typeof window !== 'undefined' ? window : globalThis);
