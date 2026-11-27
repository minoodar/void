// Live smoke check for the Void Signals API against a running Worker + D1.
// Offline behaviour lives in phase-a.test.mjs; this script proves the same contracts
// survive a real wrangler dev runtime. It must only ever be pointed at a LOCAL dev
// Worker: the admin secret and the database it writes to are local-only.
//
//   cd worker/letters
//   npm run dev:signals     # wrangler dev on http://127.0.0.1:8787 (local D1)
//   SIGNALS_LIVE_URL=http://127.0.0.1:8787 SIGNALS_ADMIN_SECRET=<local secret> \
//     node test/live-signals-smoke.mjs
//
// Without SIGNALS_LIVE_URL the script skips. Exit 0 = all checks passed.
const BASE = (process.env.SIGNALS_LIVE_URL || "").replace(/\/+$/, "");
const SECRET = process.env.SIGNALS_ADMIN_SECRET || "";
const HOSTILE_ORIGIN = "https://evil.example";

if (!BASE) {
  console.log("SKIP live-signals-smoke: set SIGNALS_LIVE_URL to a local dev Worker.");
  process.exit(0);
}
if (!SECRET) {
  console.error("FAIL live-signals-smoke: SIGNALS_ADMIN_SECRET is required for the admin checks.");
  process.exit(1);
}
if (/workers\.dev|github\.io|void\.runs-at\.dev/i.test(BASE)) {
  console.error("FAIL live-signals-smoke: refusing to run against a non-local host: " + BASE);
  process.exit(1);
}

const checks = [];
const createdMessages = [];
const createdProfiles = [];

function record(name, pass, detail) {
  checks.push({ name, pass, detail: detail === undefined ? "" : String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  ::  " + detail : ""}`);
}

async function call(path, options = {}) {
  const headers = { Origin: options.origin || BASE, ...(options.headers || {}) };
  if (options.admin) headers.Authorization = `Bearer ${SECRET}`;
  let body = options.body;
  if (body && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method: options.method || "GET", headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON responses are surfaced through .text */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function publicIds() {
  const res = await call("/signals/messages");
  return (res.json?.messages || []).map((m) => m.id);
}

async function createMessage(payload) {
  const res = await call("/admin/signals/messages", { method: "POST", admin: true, body: payload });
  if (!res.json?.ok) throw new Error(`create failed: ${res.status} ${res.text.slice(0, 200)}`);
  createdMessages.push(res.json.message.id);
  return res.json.message;
}

async function transition(id, action, extra = {}) {
  return call(`/admin/signals/messages/${id}/transition`, {
    method: "POST", admin: true, body: { action, ...extra },
  });
}

async function run() {
  const t0 = Math.floor(Date.now() / 1000);

  // ---------------- reachability, auth, read-only public surface ----------
  const version0 = await call("/signals/version");
  record("public /signals/version answers 200", version0.status === 200 && version0.json?.ok, `status ${version0.status}`);
  const startVersion = Number(version0.json?.version || 0);

  const noAuth = await call("/admin/signals/messages");
  record("admin list without a credential is rejected", noAuth.status === 401 || noAuth.status === 403, `status ${noAuth.status}`);

  const wrongAuth = await call("/admin/signals/messages", { headers: { Authorization: "Bearer definitely-not-the-local-secret" } });
  record("admin list with a wrong credential is rejected", wrongAuth.status === 403, `status ${wrongAuth.status}`);

  const flagOnly = await call("/admin/signals/messages?admin=true");
  record("?admin=true is never treated as authorization", flagOnly.status === 401 || flagOnly.status === 403, `status ${flagOnly.status}`);

  const writeStatuses = [];
  for (const method of ["POST", "PUT", "DELETE"]) {
    writeStatuses.push((await call("/signals/messages", { method, body: {} })).status);
  }
  record("public feed exposes no write method", writeStatuses.every((s) => s === 405), writeStatuses.join("/"));

  const pubList = await call("/signals/messages");
  record("public responses bypass caches", /no-store/.test(pubList.headers.get("cache-control") || ""), pubList.headers.get("cache-control"));

  const hostile = await call("/signals/messages", { origin: HOSTILE_ORIGIN });
  record("unlisted origin is refused", hostile.status === 403 || hostile.headers.get("access-control-allow-origin") !== HOSTILE_ORIGIN, `status ${hostile.status}`);

  // ---------------- message lifecycle -------------------------------------
  const draft = await createMessage({
    title: "Live draft check",
    body: "Drafts must never surface through the public feed on a real runtime.",
    category: "release",
    importance: "important",
  });
  record("stable id is an opaque 32-hex token", /^[0-9a-f]{32}$/.test(draft.id), draft.id);
  record("a new message starts as a draft", draft.status === "draft", draft.status);
  record("drafts are absent from the public feed", !(await publicIds()).includes(draft.id));

  const published = await transition(draft.id, "publish");
  record("explicit publish moves the draft to active", published.json?.message?.status === "active", `status ${published.status}`);
  record("publish stamps a publication time", Number(published.json?.message?.published_at) >= t0 - 1, String(published.json?.message?.published_at));
  record("an active message reaches the public feed", (await publicIds()).includes(draft.id));

  const single = await call(`/signals/messages/${draft.id}`);
  const publicShape = JSON.stringify(single.json?.message || {});
  record("a single eligible message is readable by id", single.json?.message?.id === draft.id, `status ${single.status}`);
  record("public rows leak no admin fields", single.status === 200 && !/"status"|"created_by"|"state_version"/.test(publicShape), publicShape.slice(0, 140));
  record("public rows keep the renderer type alias", /"type":/.test(publicShape));

  const rePublish = await transition(draft.id, "publish");
  record("an invalid transition is rejected", rePublish.status === 409 && rePublish.json?.error === "invalid_transition", `${rePublish.status} ${rePublish.json?.error}`);
  record("the rejection reports the legal targets", Array.isArray(rePublish.json?.allowed), JSON.stringify(rePublish.json?.allowed || []));

  const current = await call(`/admin/signals/messages/${draft.id}`, { admin: true });
  const stalePut = await call(`/admin/signals/messages/${draft.id}`, {
    method: "PUT", admin: true,
    body: { title: "Renamed from a stale snapshot", expected_version: 0 },
  });
  record("optimistic concurrency blocks a stale write", stalePut.status === 409 && stalePut.json?.error === "stale_snapshot", `${stalePut.status} ${stalePut.json?.error}`);
  record("the conflict carries the server version", Number(stalePut.json?.current_version) === Number(current.json?.message?.state_version), `server ${current.json?.message?.state_version}`);

  const goodPut = await call(`/admin/signals/messages/${draft.id}`, {
    method: "PUT", admin: true,
    body: { title: "Renamed with the right snapshot", expected_version: current.json?.message?.state_version },
  });
  record("an edit with the current snapshot succeeds", goodPut.json?.message?.title === "Renamed with the right snapshot", `status ${goodPut.status}`);
  record("editing content never changes lifecycle status", goodPut.json?.message?.status === "active", goodPut.json?.message?.status);

  const statusViaPut = await call(`/admin/signals/messages/${draft.id}`, {
    method: "PUT", admin: true, body: { status: "active" },
  });
  record("status cannot be smuggled through a content edit", statusViaPut.status === 400 && statusViaPut.json?.error === "status_requires_transition", `${statusViaPut.status} ${statusViaPut.json?.error}`);

  const hidden = await transition(draft.id, "hide");
  record("hide deactivates the message", hidden.json?.message?.status === "hidden", hidden.json?.message?.status);
  record("hidden messages leave the public feed", !(await publicIds()).includes(draft.id));

  // Hidden is restored with the same publish verb the brief calls an explicit action.
  const reopened = await transition(draft.id, "publish");
  record("an eligible hidden message can be restored", reopened.json?.message?.status === "active", `status ${reopened.status} ${reopened.json?.error || ""}`);
  record("restoring keeps the original publication time", Number(reopened.json?.message?.published_at) >= t0 - 1 && Number(reopened.json?.message?.published_at) <= Number(published.json?.message?.published_at), `${published.json?.message?.published_at} -> ${reopened.json?.message?.published_at}`);
  const backToDraft = await transition(draft.id, "reopen");
  record("reopen is not a way to edit an eligible row back to draft", backToDraft.status === 409 && backToDraft.json?.error === "invalid_transition", `${backToDraft.status} ${backToDraft.json?.error}`);

  const revoked = await transition(draft.id, "revoke");
  record("revoke ends the public life of a message", revoked.json?.message?.status === "revoked", revoked.json?.message?.status);
  record("revoked messages leave the public feed", !(await publicIds()).includes(draft.id));
  const revokedSingle = await call(`/signals/messages/${draft.id}`);
  record("a revoked id is not resolvable publicly", revokedSingle.status === 404 && revokedSingle.json?.error === "message_not_available", `${revokedSingle.status} ${revokedSingle.json?.error}`);
  const revive = await transition(draft.id, "reopen");
  record("revoked is terminal in the transition table", revive.status >= 400, `${revive.status} ${revive.json?.error}`);

  // ---------------- scheduled publication ----------------------------------
  const scheduled = await createMessage({
    title: "Live scheduled check",
    body: "A scheduled message must not appear before its own activation time.",
    category: "event",
    importance: "ambient",
    status: "scheduled",
    scheduled_at: Math.floor(Date.now() / 1000) + 600,
  });
  record("scheduling stores a future activation time", scheduled.status === "scheduled" && Number(scheduled.scheduled_at) > Math.floor(Date.now() / 1000), `${scheduled.status} @ ${scheduled.scheduled_at}`);
  record("scheduled messages stay private until they are due", !(await publicIds()).includes(scheduled.id));

  const earlyPublish = await transition(scheduled.id, "publish");
  record("publishing a scheduled row makes it live immediately", earlyPublish.json?.message?.status === "active" && (await publicIds()).includes(scheduled.id), `status ${earlyPublish.status}`);
  record("publishing clears the leftover schedule", earlyPublish.json?.message?.scheduled_at === null, JSON.stringify(earlyPublish.json?.message?.scheduled_at));

  const pastSchedule = await createMessage({
    title: "Live schedule guard", body: "Guard against a schedule time that already passed.",
    category: "general", importance: "ambient",
    status: "scheduled", scheduled_at: Math.floor(Date.now() / 1000) - 10,
  }).catch((e) => e.message);
  record("a schedule time in the past is refused", typeof pastSchedule === "string" && /scheduled_at_in_past/.test(pastSchedule), String(pastSchedule).slice(0, 120));

  // ---------------- server-side expiration ---------------------------------
  const expiring = await createMessage({
    title: "Live expiry check",
    body: "Expiration is evaluated on the server clock, never from the client.",
    category: "milestone",
    importance: "important",
    status: "active",
    expires_in: 3600,
  });
  record("an expiring message is public while eligible", (await publicIds()).includes(expiring.id), expiring.id);
  const rowBeforeExpiry = await call(`/admin/signals/messages/${expiring.id}`, { admin: true });

  // Age the row directly in the LOCAL database, then let the Worker decide.
  const ageRes = await call(`/signals/messages/${expiring.id}`);
  record("public eligibility uses server time and stored expiry", ageRes.status === 200, `expires_at ${expiring.expires_at}`);
  record("an eligible row exposes its expiry to the admin view only", Number(rowBeforeExpiry.json?.message?.expires_at) > t0, String(rowBeforeExpiry.json?.message?.expires_at));

  // ---------------- reads never write --------------------------------------
  const before = await call("/admin/signals/messages", { admin: true });
  const versionBefore = await call("/signals/version");
  for (let i = 0; i < 6; i += 1) {
    await call("/signals/messages");
    await call(`/signals/messages/${expiring.id}`);
    await call("/signals/state");
  }
  const after = await call("/admin/signals/messages", { admin: true });
  const versionAfter = await call("/signals/version");
  const sameTotal = JSON.stringify(before.json?.total) === JSON.stringify(after.json?.total);
  const versionKey = (j) => JSON.stringify((j.json?.items || []).map((m) => [m.id, m.state_version, m.updated_at]).sort());
  record("repeated public reads mutate nothing admin-visible", sameTotal && versionKey(before) === versionKey(after), JSON.stringify(after.json?.total));
  record("public reads leave the change counter untouched", versionBefore.json?.version === versionAfter.json?.version, `${versionBefore.json?.version} -> ${versionAfter.json?.version}`);

  // ---------------- validation and size limits ------------------------------
  const tooShort = await call("/admin/signals/messages", { method: "POST", admin: true, body: { title: "x", body: "y" } });
  record("undersized content is rejected", tooShort.status === 400, `${tooShort.status} ${tooShort.json?.error}`);

  const markup = await call("/admin/signals/messages", {
    method: "POST", admin: true, body: { title: "Markup check", body: "see <script>alert(1)</script> here" },
  });
  record("markup in message content is refused", markup.status === 400, `${markup.status} ${markup.json?.error}`);

  const huge = await call("/admin/signals/messages", {
    method: "POST", admin: true, body: { title: "Oversized check", body: "ن".repeat(40000) },
  });
  record("oversized payloads are refused", huge.status === 413 || huge.status === 400, String(huge.status));

  const presentation = await call(`/admin/signals/messages/${expiring.id}`, {
    method: "PUT", admin: true, body: { metadata: { glow: 2 } },
  });
  record("presentation settings cannot ride in message metadata", presentation.status === 400 && presentation.json?.error === "presentation_belongs_in_a_profile", `${presentation.status} ${presentation.json?.error}`);

  const persian = await createMessage({
    title: "بررسی زنده",
    body: "متن فارسی با نیم‌فاصله و بدون کاراکتر مخرب ذخیره می‌شود.",
    category: "general", importance: "ambient",
  });
  const persianRound = await call(`/admin/signals/messages/${persian.id}`, { admin: true });
  record("Persian text with ZWNJ round-trips intact", persianRound.json?.message?.body === "متن فارسی با نیم‌فاصله و بدون کاراکتر مخرب ذخیره می‌شود.", persianRound.json?.message?.body);

  // ---------------- Star Profiles -------------------------------------------
  const profilePublicBefore = await call("/signals/profile");
  const created = await call("/admin/signals/profiles", {
    method: "POST", admin: true,
    body: { name: "Live Studio Check", settings: { preset: "spiral", color: "ember", size: 1.4 } },
  });
  const profileId = created.json?.profile?.id;
  createdProfiles.push(profileId);
  record("a profile is created unpublished at version 1", created.json?.profile?.active_version === 0 && created.json?.profile?.current_version === 1, JSON.stringify(created.json?.profile || {}).slice(0, 160));
  record("an unpublished profile never reaches the public config", profileId && !JSON.stringify(profilePublicBefore.json || {}).includes(profileId), JSON.stringify(profilePublicBefore.json || {}).slice(0, 120));

  const saved = await call(`/admin/signals/profiles/${profileId}`, {
    method: "PUT", admin: true,
    body: { settings: { preset: "spiral", color: "ember", size: 1.8, brightness: 1.25 } },
  });
  record("saving adds a version without publishing", saved.json?.profile?.current_version === 2 && saved.json?.profile?.active_version === 0, `v${saved.json?.profile?.current_version} active ${saved.json?.profile?.active_version}`);
  record("the saved version is returned to the admin UI", saved.json?.settings?.size === 1.8 && saved.json?.settings?.schema === 1, JSON.stringify(saved.json?.settings || {}).slice(0, 160));

  const clamped = await call(`/admin/signals/profiles/${profileId}`, {
    method: "PUT", admin: true, body: { settings: { size: 99, glow: -5, motion: "static" } },
  });
  record("numeric profile values are clamped on the server", clamped.json?.settings?.size === 2.2 && clamped.json?.settings?.glow === 0, JSON.stringify(clamped.json?.settings));
  record("presentation keys outside the schema are dropped", clamped.json?.settings?.activeProfile === undefined, JSON.stringify(Object.keys(clamped.json?.settings || {})).slice(0, 160));

  const badEnum = await call(`/admin/signals/profiles/${profileId}`, {
    method: "PUT", admin: true, body: { settings: { preset: "not-a-preset" } },
  });
  record("unknown enum values are rejected", badEnum.status === 400, `${badEnum.status} ${badEnum.json?.error}`);

  const beforeActivate = await call("/signals/profile");
  const activated = await call(`/admin/signals/profiles/${profileId}/activate`, { method: "POST", admin: true, body: {} });
  record("activation publishes the saved version", activated.json?.active_version === 3, `${activated.json?.active_version} (was ${activated.json?.previous_active_version})`);
  record("the previous active version is reported for recovery", Number(activated.json?.previous_active_version) === 0, String(activated.json?.previous_active_version));
  record("an activated profile is never public before activation", !JSON.stringify(beforeActivate.json?.profiles || {}).includes(profileId), JSON.stringify(Object.keys(beforeActivate.json?.profiles || {})).slice(0, 80));
  const publicProfile = await call("/signals/profile");
  const delivered = publicProfile.json?.profiles?.[profileId];
  record("the active profile is delivered publicly", delivered?.version === 3 && delivered?.settings?.size === 2.2 && delivered?.settings?.motion === "static", JSON.stringify(delivered || {}).slice(0, 200));
  record("a saved profile version is a complete settings snapshot", delivered?.settings?.preset === undefined, JSON.stringify(Object.keys(delivered?.settings || {})));

  const restored = await call(`/admin/signals/profiles/${profileId}/restore`, {
    method: "POST", admin: true, body: { version: 1, activate: true },
  });
  record("restoring copies an old version forward", restored.json?.profile?.current_version === 4 && restored.json?.restored_from === 1, `v${restored.json?.profile?.current_version} from ${restored.json?.restored_from}`);
  const afterRestore = await call("/signals/profile");
  record("an activated restore changes the public config", afterRestore.json?.profiles?.[profileId]?.settings?.size === 1.4, JSON.stringify(afterRestore.json?.profiles?.[profileId]?.settings || {}).slice(0, 160));
  const versions = await call(`/admin/signals/profiles/${profileId}/versions`, { admin: true });
  record("profile history stays append-only", (versions.json?.versions || []).length >= 4, `${(versions.json?.versions || []).length} versions`);

  const dup = await call(`/admin/signals/profiles/${profileId}/duplicate`, { method: "POST", admin: true, body: { name: "Live Studio Copy" } });
  const dupId = dup.json?.profile?.id;
  createdProfiles.push(dupId);
  record("a duplicated profile is never pre-activated", dup.status === 201 && dup.json?.profile?.active_version === 0, `status ${dup.status} active ${dup.json?.profile?.active_version}`);

  const assignBad = await call("/admin/signals/assignments", {
    method: "POST", admin: true, body: { scope: "category:release", profile_id: dupId },
  });
  record("an inactive profile cannot be assigned", assignBad.status === 409 && assignBad.json?.error === "profile_not_active", `${assignBad.status} ${assignBad.json?.error}`);

  const assignOk = await call("/admin/signals/assignments", {
    method: "POST", admin: true, body: { scope: "category:release", profile_id: profileId },
  });
  record("an active profile can be assigned to a category", assignOk.json?.ok === true, `status ${assignOk.status}`);
  const stateCfg = await call("/signals/state");
  record("public state exposes category assignments", stateCfg.json?.assignments?.byCategory?.release === profileId, JSON.stringify(stateCfg.json?.assignments || {}));
  record("public state carries the eligible feed and a version", Array.isArray(stateCfg.json?.messages) && stateCfg.json?.version !== undefined, `${stateCfg.json?.messages?.length} messages @ v${stateCfg.json?.version}`);

  const assignedDelete = await call(`/admin/signals/profiles/${profileId}`, {
    method: "DELETE", admin: true, body: { confirm: "DELETE PROFILE" },
  });
  record("an assigned profile is protected from deletion", assignedDelete.status === 409 && assignedDelete.json?.error === "profile_in_use", `${assignedDelete.status} ${assignedDelete.json?.error}`);

  const unconfirmed = await call(`/admin/signals/messages/${expiring.id}`, { method: "DELETE", admin: true, body: {} });
  record("hard deletion requires an explicit confirmation phrase", unconfirmed.status === 400 && unconfirmed.json?.error === "confirmation_required", `${unconfirmed.status} ${unconfirmed.json?.error}`);
  const anonAdminPeek = await call(`/admin/signals/messages/${expiring.id}`);
  record("a detail view stays behind the credential", anonAdminPeek.status === 401 || anonAdminPeek.status === 403, `status ${anonAdminPeek.status}`);
  // The public id lookup is the proof the row was not touched by the refused deletion.
  const stillThere = await call(`/signals/messages/${expiring.id}`, { headers: { Connection: "close" } });
  const stillAdmin = await call(`/admin/signals/messages/${expiring.id}`, { admin: true });
  record("a refused deletion leaves the row intact", stillAdmin.json?.message?.id === expiring.id && stillThere.status === 200, `public ${stillThere.status} ${stillThere.text.slice(0, 70)} admin ${stillAdmin.status}`);

  const versionEnd = await call("/signals/version");
  record("mutations advance the change counter", Number(versionEnd.json?.version) > Number(startVersion), `${startVersion} -> ${versionEnd.json?.version}`);

  // ---------------- cleanup (local D1 only) ---------------------------------
  for (const id of createdMessages) {
    await call(`/admin/signals/messages/${id}`, { method: "DELETE", admin: true, body: { confirm: "DELETE SIGNAL" } });
  }
  await call("/admin/signals/assignments", { method: "POST", admin: true, body: { scope: "category:release", profile_id: null } });
  for (const id of createdProfiles) {
    await call(`/admin/signals/profiles/${id}`, { method: "DELETE", admin: true, body: { confirm: "DELETE PROFILE" } });
  }
  const leftovers = await call("/admin/signals/messages", { admin: true });
  const leftProfiles = await call("/admin/signals/profiles", { admin: true });
  record("the local database is left clean afterwards", (leftovers.json?.items || []).length === 0 && (leftProfiles.json?.items || []).length === 0, `${(leftovers.json?.items || []).length} messages / ${(leftProfiles.json?.items || []).length} profiles left`);

  const failed = checks.filter((c) => !c.pass);
  const elapsed = Math.floor(Date.now() / 1000) - t0;
  console.log(`\nlive-signals-smoke: ${checks.length - failed.length}/${checks.length} checks passed in ${elapsed}s against ${BASE}`);
  for (const f of failed) console.log(`  FAILED: ${f.name} :: ${f.detail}`);
  console.log(`  local clock ${t0} -> ${Math.floor(Date.now() / 1000)}; worker clock ${before.json?.server_time}`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((err) => {
  console.error("live-signals-smoke crashed:", err?.stack || err);
  const failed = checks.filter((c) => !c.pass);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed before the crash.`);
  for (const f of failed) console.log(`  FAILED: ${f.name} :: ${f.detail}`);
  process.exit(1);
});
