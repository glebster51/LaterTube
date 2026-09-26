const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const stored = {
  firebaseStateCacheV1: {
    uid: "uid-1",
    active: [{ id: "abcdefghijk", title: "Cached video" }],
    history: [],
    updatedAt: 123,
    cachedAt: 1
  }
};

let messageListener;
let versionChecks = 0;
let fullLoads = 0;

const chrome = {
  action: {
    onClicked: { addListener() {} },
    async setBadgeBackgroundColor() {},
    async setBadgeText() {}
  },
  contextMenus: {
    onClicked: { addListener() {} },
    removeAll(callback) { callback(); },
    create() {}
  },
  i18n: { getMessage: key => key },
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { messageListener = listener; } },
    getURL: value => value
  },
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") return { [key]: stored[key] };
        return { ...stored };
      },
      async set(values) { Object.assign(stored, values); },
      async remove(key) { delete stored[key]; }
    }
  },
  tabs: { async create() {}, async query() { return []; }, async remove() {} }
};

const LaterTubeFirebase = {
  async getAuthStatus() { return { signedIn: true, email: "owner@example.com", uid: "uid-1" }; },
  async getStateIfChanged(updatedAt) {
    versionChecks++;
    assert.equal(updatedAt, 123);
    return { notModified: true, updatedAt: 123, uid: "uid-1" };
  },
  async getState() {
    fullLoads++;
    return { active: [], history: [], updatedAt: 0, uid: "uid-1" };
  }
};

const context = vm.createContext({
  chrome,
  console,
  importScripts() {},
  LaterTubeFirebase,
  LaterTubeCloudState: {},
  setTimeout
});

vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"),
  context,
  { filename: "background.js" }
);

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("message timed out")), 1000);
    messageListener(message, {}, result => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

(async () => {
  const cached = await sendMessage({ type: "GET_CACHED_STATE" });
  assert.equal(cached.fromCache, true);
  assert.equal(cached.active[0].title, "Cached video");

  const refreshed = await sendMessage({ type: "GET_CLOUD_STATE", force: true });
  assert.equal(refreshed.notModified, true);
  assert.equal(refreshed.active[0].id, "abcdefghijk");
  assert.equal(versionChecks, 1);
  assert.equal(fullLoads, 0);
  console.log("background cache tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
