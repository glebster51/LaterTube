const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const stored = {};
const requests = [];
let serverState = null;
let etagVersion = 1;

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: name => headers[String(name).toLowerCase()] || null },
    text: async () => payload === null || payload === undefined ? "" : JSON.stringify(payload)
  };
}

async function fetchMock(url, options = {}) {
  const method = options.method || "GET";
  requests.push({ url, method, headers: options.headers || {}, body: options.body });
  if (url.includes("accounts:sendOobCode")) {
    const resetRequest = JSON.parse(options.body);
    assert.deepEqual(resetRequest, {
      requestType: "PASSWORD_RESET",
      email: resetRequest.email
    });
    if (resetRequest.email === "missing@example.com") {
      return response(400, { error: { message: "EMAIL_NOT_FOUND" } });
    }
    return response(200, { email: "owner@example.com" });
  }
  if (url.includes("accounts:signUp")) {
    return response(200, {
      idToken: "id-token-1",
      refreshToken: "refresh-token-1",
      localId: "uid-1",
      email: "owner@example.com",
      expiresIn: "3600"
    });
  }
  if (url.includes("securetoken.googleapis.com")) {
    return response(200, {
      id_token: "id-token-2",
      refresh_token: "refresh-token-2",
      user_id: "uid-1",
      expires_in: "3600"
    });
  }
  if (url.includes("/users/uid-1/updatedAt.json")) {
    return response(200, serverState?.updatedAt || null);
  }
  if (url.includes("/users/uid-1.json")) {
    if (method === "GET") return response(200, serverState, { etag: `\"${etagVersion}\"` });
    if (method === "PUT") {
      assert.equal(options.headers["If-Match"], `\"${etagVersion}\"`);
      serverState = JSON.parse(options.body);
      etagVersion++;
      return response(200, serverState, { etag: `\"${etagVersion}\"` });
    }
  }
  return response(404, { error: "not found" });
}

const chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") return { [key]: stored[key] };
        return { ...stored };
      },
      async set(values) { Object.assign(stored, values); },
      async remove(key) { delete stored[key]; }
    }
  }
};

const context = vm.createContext({
  chrome,
  console,
  crypto: { randomUUID: () => "test-change-id" },
  fetch: fetchMock,
  LaterTubeFirebaseConfig: {
    apiKey: "test-api-key",
    databaseUrl: "https://test-default-rtdb.firebaseio.com"
  },
  setTimeout,
  URLSearchParams
});

for (const file of ["cloud-state.js", "firebase-client.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
}

(async () => {
  const client = context.LaterTubeFirebase;
  assert.deepEqual(
    JSON.parse(JSON.stringify(await client.requestPasswordReset("owner@example.com"))),
    { resetEmailSent: true }
  );
  assert.equal(stored.firebaseAuth, undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await client.requestPasswordReset("missing@example.com"))),
    { resetEmailSent: true }
  );

  const initial = await client.authenticate("owner@example.com", "secret-password", true);
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), {
    active: [], history: [], updatedAt: 0, uid: "uid-1"
  });
  assert.equal(stored.firebaseAuth.uid, "uid-1");
  assert.equal(stored.firebaseAuth.refreshToken, "refresh-token-1");
  assert.equal(Object.hasOwn(stored, "watchLaterVideos"), false);

  const added = await client.addVideos([{ id: "abcdefghijk", title: "Test video" }]);
  assert.equal(added.results[0].added, true);
  assert.equal(added.active.length, 1);
  assert.equal(added.history.length, 0);
  assert.equal(serverState.active.videos[0].id, "abcdefghijk");

  const archived = await client.archiveVideos(["abcdefghijk"]);
  assert.equal(archived.archivedIds[0], "abcdefghijk");
  assert.equal(archived.active.length, 0);
  assert.equal(archived.history.length, 1);
  assert.ok(archived.history[0].removedAt > 0);

  const restored = await client.restoreVideos(["abcdefghijk"]);
  assert.equal(restored.restoredIds[0], "abcdefghijk");
  assert.equal(restored.active.length, 1);
  assert.equal(restored.history.length, 0);

  const archivedForDeletion = await client.archiveVideos(["abcdefghijk"]);
  assert.equal(archivedForDeletion.history.length, 1);
  const deleted = await client.deleteHistoryVideos(["abcdefghijk"]);
  assert.equal(deleted.deletedIds[0], "abcdefghijk");
  assert.equal(deleted.active.length, 0);
  assert.equal(deleted.history.length, 0);

  const rootGetsBeforeVersionCheck = requests.filter(request =>
    request.method === "GET" && request.url.includes("/users/uid-1.json")
  ).length;
  const unchanged = await client.getStateIfChanged(deleted.updatedAt);
  assert.equal(unchanged.notModified, true);
  assert.equal(unchanged.updatedAt, deleted.updatedAt);
  assert.equal(requests.filter(request =>
    request.method === "GET" && request.url.includes("/users/uid-1.json")
  ).length, rootGetsBeforeVersionCheck);

  const putRequests = requests.filter(request => request.method === "PUT");
  assert.equal(putRequests.length, 5);
  assert.ok(putRequests.every(request => request.headers["If-Match"]));

  await client.signOut();
  assert.equal(stored.firebaseAuth, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(await client.getAuthStatus())), { signedIn: false, email: "", uid: "" });
  console.log("firebase-client tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
