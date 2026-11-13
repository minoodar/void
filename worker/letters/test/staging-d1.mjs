import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const expectedOrigin = 'https://void-galaxy-letters-phase4-staging.minoodar.workers.dev';
const endpoint = new URL(process.env.STAGING_WORKER_URL || expectedOrigin);
assert.equal(endpoint.origin, expectedOrigin, 'Refusing any endpoint except the Phase 4 staging Worker');
assert.equal(endpoint.pathname, '/', 'STAGING_WORKER_URL must be the Worker origin only');
const adminSecret = process.env.ADMIN_SECRET;
if (!adminSecret) throw new Error('Set ADMIN_SECRET in the local process environment; the value is never printed.');
const auth = 'Bearer ' + adminSecret;
const titlePrefix = 'PHASE4-STAGING-SYNTHETIC:';
const reuseIds = (process.env.STAGING_REUSE_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const createdIds = [];
const originalDomains = new Map();
let runFailure = null;

async function request(path, options = {}) {
  const headers = { Authorization: auth };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(new URL(path, endpoint), {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30000)
    });
  } catch (_) {
    throw new Error('Network failure for staging request ' + path);
  }
  let data;
  try { data = await response.json(); } catch (_) { throw new Error('Non-JSON response from staging request ' + path); }
  return { status: response.status, data };
}
function okStatus(result, expected, label) {
  assert.equal(result.status, expected, label + ' HTTP status');
}
async function tracks() {
  const result = await request('/admin/tracks');
  okStatus(result, 200, 'Admin track listing');
  assert.ok(result.data && Array.isArray(result.data.tracks), 'Admin track listing shape');
  return result.data.tracks;
}
async function domainTracks() {
  const result = await request('/admin/domain-tracks');
  okStatus(result, 200, 'Admin domain listing');
  assert.ok(result.data && Array.isArray(result.data.tracks), 'Domain listing shape');
  return result.data.tracks;
}
async function mutate(operation, ids, domainNames = ['inner']) {
  return request('/admin/domain-classifications', {
    method: 'POST',
    body: { operation, items: ids.map(id => ({ id, domains: domainNames })) }
  });
}
async function membershipCount(ids, domain) {
  const wanted = new Set(ids);
  const rows = await domainTracks();
  return rows.filter(row => wanted.has(row.id) && row.domains.includes(domain)).length;
}
async function createTrack(label) {
  const result = await request('/admin/tracks', {
    method: 'POST',
    body: {
      title: titlePrefix + label,
      artist: 'Phase 4 staging verification',
      audio_url: 'https://example.invalid/phase4/' + label + '.mp3',
      tags: ['phase4-staging-test']
    }
  });
  okStatus(result, 201, 'Create synthetic staging track');
  assert.ok(result.data && result.data.track && typeof result.data.track.id === 'string', 'Created track response shape');
  return result.data.track.id;
}
async function acceptExactUnclassifiedSnapshot() {
  const readiness = await request('/admin/domain-readiness');
  okStatus(readiness, 200, 'Readiness before acceptance');
  const accepted = await request('/admin/domain-release/accept', {
    method: 'POST',
    body: { expected_state_version: readiness.data.state_version }
  });
  okStatus(accepted, 200, 'Exact acceptance snapshot');
  assert.deepEqual([...accepted.data.accepted_ids].sort(), readiness.data.unclassified.map(x => x.id).sort(), 'Acceptance stores exactly the listed IDs');
}
async function run() {
  const status = await request('/site/domain-status');
  okStatus(status, 200, 'Staging feature status');
  const readiness = await request('/admin/domain-readiness');
  okStatus(readiness, 200, 'Phase 4 schema/readiness preflight');

  const existing = await tracks();
  assert.ok(existing.length <= 198, 'Need room for 2 synthetic deletion tracks under MAX_TRACKS=200');
  if (existing.length) {
    assert.deepEqual([...reuseIds].sort(), existing.map(x => x.id).sort(), 'Every existing staging track must be explicitly identified as synthetic before reuse');
    const rows = await domainTracks();
    for (const id of reuseIds) {
      const row = rows.find(x => x.id === id);
      assert.ok(row, 'Explicit reusable staging track exists');
      originalDomains.set(id, row.domains.slice());
    }
    const clear = await request('/admin/domain-classifications', {
      method: 'POST',
      body: { operation: 'set', items: reuseIds.map(id => ({ id, domains: [] })) }
    });
    okStatus(clear, 200, 'Clear only explicitly designated staging test tracks');
  } else {
    assert.equal(reuseIds.length, 0, 'STAGING_REUSE_IDS supplied while no staging tracks exist');
  }

  const needed = 200 - existing.length;
  for (let i = 0; i < needed; i++) createdIds.push(await createTrack('run-' + randomUUID() + '-' + i));
  const ids = existing.map(x => x.id).concat(createdIds);
  assert.equal(ids.length, 200, 'Prepare exact 200-target test set');

  for (const size of [1, 3, 20, 200]) {
    const batchIds = ids.slice(0, size);
    const before = await membershipCount(batchIds, 'inner');
    assert.equal(before, 0, 'Fresh counter test set has no inner memberships');
    const added = await mutate('add', batchIds);
    okStatus(added, 200, size + '-target add');
    assert.equal(added.data.applied, size, size + '-target applied counter');
    assert.equal(await membershipCount(batchIds, 'inner'), size, size + '-target actual D1 memberships');
    const repeated = await mutate('add', batchIds);
    okStatus(repeated, 200, size + '-target idempotent repeat');
    assert.equal(repeated.data.applied, 0, size + '-target repeated counter');
    assert.equal(await membershipCount(batchIds, 'inner'), size, size + '-target repeated actual memberships');
    const removed = await mutate('remove', batchIds);
    okStatus(removed, 200, size + '-target remove');
    assert.equal(removed.data.applied, size, size + '-target removal counter');
    assert.equal(await membershipCount(batchIds, 'inner'), 0, size + '-target actual membership removals');
  }

  const before201 = await domainTracks();
  const oversized = Array.from({ length: 201 }, (_, i) => ({ id: 'phase4-over-' + i, domains: ['inner'] }));
  const rejected201 = await request('/admin/domain-classifications', { method: 'POST', body: { operation: 'add', items: oversized } });
  okStatus(rejected201, 400, '201-target rejection');
  assert.equal(rejected201.data.committed, false, '201-target rejection is atomic');
  assert.equal((await domainTracks()).length, before201.length, '201-target rejection changes no track memberships');

  const auditBeforeUnknown = await request('/admin/domain-audit');
  okStatus(auditBeforeUnknown, 200, 'Audit listing before unknown-track test');
  const missingId = 'phase4-unknown-' + randomUUID().replaceAll('-', '');
  const unknown = await request('/admin/domain-classifications', {
    method: 'POST',
    body: { operation: 'add', items: [{ id: ids[0], domains: ['beyond'] }, { id: missingId, domains: ['inner'] }] }
  });
  okStatus(unknown, 404, 'Unknown Track rejection');
  assert.equal(unknown.data.committed, false, 'Unknown Track batch reports rollback');
  assert.equal(await membershipCount(ids, 'beyond'), 0, 'Unknown Track batch made no partial membership');
  const auditAfterUnknown = await request('/admin/domain-audit');
  assert.equal(auditAfterUnknown.data.records.length, auditBeforeUnknown.data.records.length, 'Unknown Track batch left no audit record');

  const successfulAdd = await mutate('add', [ids[0]], ['inner']);
  okStatus(successfulAdd, 200, 'Create successful Undo batch');
  const successfulUndo = await request('/admin/domain-audit/' + successfulAdd.data.batch_id + '/undo', { method: 'POST', body: {} });
  okStatus(successfulUndo, 200, 'Successful Undo');
  const repeatedUndo = await request('/admin/domain-audit/' + successfulAdd.data.batch_id + '/undo', { method: 'POST', body: {} });
  okStatus(repeatedUndo, 409, 'Repeated Undo conflict');

  const conflictingAdd = await mutate('add', [ids[1]], ['flow']);
  await mutate('remove', [ids[1]], ['flow']);
  await mutate('add', [ids[1]], ['flow']);
  const conflictingUndo = await request('/admin/domain-audit/' + conflictingAdd.data.batch_id + '/undo', { method: 'POST', body: {} });
  okStatus(conflictingUndo, 409, 'Conflicting Undo');
  assert.equal(conflictingUndo.data.committed, false, 'Conflicting Undo is atomic');

  const concurrentAdd = await mutate('add', [ids[2]], ['beyond']);
  const concurrent = await Promise.all([
    request('/admin/domain-audit/' + concurrentAdd.data.batch_id + '/undo', { method: 'POST', body: {} }),
    request('/admin/domain-audit/' + concurrentAdd.data.batch_id + '/undo', { method: 'POST', body: {} })
  ]);
  assert.equal(concurrent.filter(x => x.status === 200).length, 1, 'Exactly one authenticated concurrent Undo succeeds');
  assert.equal(concurrent.filter(x => x.status === 409).length, 1, 'The other authenticated concurrent Undo conflicts, never 401');
  assert.equal(await membershipCount([ids[2]], 'beyond'), 0, 'Concurrent Undo leaves final membership removed');
  const auditAfterConcurrent = await request('/admin/domain-audit');
  const undoRecords = auditAfterConcurrent.data.records.filter(x => x.undo_of_batch_id === concurrentAdd.data.batch_id);
  assert.equal(undoRecords.length, 1, 'Concurrent Undo produced exactly one audit record');

  const deletionIds = createdIds.slice(-2);
  assert.equal(deletionIds.length, 2, 'Two newly created tracks reserved for deletion counters');
  const marked = await mutate('add', deletionIds, ['inner', 'flow']);
  okStatus(marked, 200, 'Create deletion counter memberships');
  const countBeforeDelete = (await tracks()).length;
  for (const id of deletionIds) {
    const deleted = await request('/admin/tracks/' + encodeURIComponent(id), { method: 'DELETE' });
    okStatus(deleted, 200, 'Single-track deletion');
    assert.equal(deleted.data.deleted, 1, 'Deletion counter reports one deleted track');
  }
  const countAfterDelete = (await tracks()).length;
  assert.equal(countBeforeDelete - countAfterDelete, 2, 'Two tracks were actually deleted');
  assert.equal(await membershipCount(deletionIds, 'inner'), 0, 'Deletion removed domain memberships');
  const deletionAudit = await request('/admin/domain-audit');
  for (const id of deletionIds) assert.ok(deletionAudit.data.records.some(x => x.operation === 'track_delete' && x.track_id === id), 'Deletion audit history is preserved');

  await acceptExactUnclassifiedSnapshot();
  const newTrackId = await createTrack('new-unclassified-' + randomUUID());
  createdIds.push(newTrackId);
  const readinessAfterNewTrack = await request('/admin/domain-readiness');
  assert.equal(readinessAfterNewTrack.data.ready, false, 'New unclassified track invalidates the accepted snapshot');
  assert.equal(readinessAfterNewTrack.data.accepted_ids.includes(newTrackId), false, 'New track is not automatically accepted');
}
async function cleanup() {
  for (const id of createdIds.slice().reverse()) {
    try { await request('/admin/tracks/' + encodeURIComponent(id), { method: 'DELETE' }); }
    catch (_) { /* Continue cleanup; report only a generic failure below. */ }
  }
  if (originalDomains.size) {
    try {
      await request('/admin/domain-classifications', {
        method: 'POST',
        body: { operation: 'set', items: Array.from(originalDomains, ([id, domains]) => ({ id, domains })) }
      });
    } catch (_) { throw new Error('Could not restore explicitly reused staging tracks.'); }
  }
}
try {
  await run();
} catch (error) {
  runFailure = error;
} finally {
  try { await cleanup(); } catch (error) { if (!runFailure) runFailure = error; }
}
if (runFailure) throw runFailure;
console.log('Actual staging D1 Worker API scenarios passed: counters 1/3/20/200, 201 rejection, unknown Track rollback, idempotency, deletion counts/history, acceptance snapshot, successful/repeated/conflicting Undo, authenticated concurrent Undo.');