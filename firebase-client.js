(function (root) {
  "use strict";

  const AUTH_STORAGE_KEY = "firebaseAuth";
  const IDENTITY_API = "https://identitytoolkit.googleapis.com/v1";
  const TOKEN_API = "https://securetoken.googleapis.com/v1/token";
  const MAX_RETRIES = 3;
  let currentSession = null;

  class CloudError extends Error {
    constructor(code, message, status = 0) {
      super(message || code);
      this.name = "CloudError";
      this.code = code;
      this.status = status;
    }
  }

  function config() {
    const value = root.LaterTubeFirebaseConfig || {};
    const apiKey = String(value.apiKey || "").trim();
    const databaseUrl = String(value.databaseUrl || "").trim().replace(/\/$/, "");
    if (!apiKey || !databaseUrl || /YOUR_FIREBASE|YOUR_PROJECT/.test(`${apiKey}${databaseUrl}`)) {
      throw new CloudError("FIREBASE_NOT_CONFIGURED", "Firebase is not configured for this local build");
    }
    return { apiKey, databaseUrl };
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { throw new CloudError("INVALID_CLOUD_DATA", "Firebase returned invalid JSON", response.status); }
  }

  function authError(payload, fallback, status) {
    const raw = String(payload?.error?.message || fallback || "Firebase authentication failed");
    const key = raw.split(" : ")[0];
    const known = {
      EMAIL_EXISTS: "EMAIL_EXISTS",
      EMAIL_NOT_FOUND: "INVALID_CREDENTIALS",
      INVALID_PASSWORD: "INVALID_CREDENTIALS",
      INVALID_LOGIN_CREDENTIALS: "INVALID_CREDENTIALS",
      INVALID_EMAIL: "INVALID_EMAIL",
      MISSING_EMAIL: "INVALID_EMAIL",
      USER_DISABLED: "USER_DISABLED",
      WEAK_PASSWORD: "WEAK_PASSWORD",
      TOO_MANY_ATTEMPTS_TRY_LATER: "TOO_MANY_ATTEMPTS",
      RESET_PASSWORD_EXCEED_LIMIT: "TOO_MANY_ATTEMPTS",
      OPERATION_NOT_ALLOWED: "EMAIL_AUTH_DISABLED"
    };
    return new CloudError(known[key] || "AUTH_FAILED", raw, status);
  }

  async function saveSession(payload, email) {
    const refreshToken = payload.refreshToken || payload.refresh_token;
    const uid = payload.localId || payload.user_id;
    const idToken = payload.idToken || payload.id_token;
    const expiresIn = Number(payload.expiresIn || payload.expires_in || 3600);
    if (!refreshToken || !uid || !idToken) throw new CloudError("AUTH_FAILED", "Firebase did not return a complete session");
    const stored = { refreshToken, uid, email: email || payload.email || "" };
    await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: stored });
    currentSession = {
      ...stored,
      idToken,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
    };
    return currentSession;
  }

  async function authenticate(email, password, createAccount) {
    const { apiKey } = config();
    const endpoint = createAccount ? "accounts:signUp" : "accounts:signInWithPassword";
    const response = await fetch(`${IDENTITY_API}/${endpoint}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw authError(payload, response.statusText, response.status);
    await saveSession(payload, email);
    return getState();
  }

  async function requestPasswordReset(email) {
    const { apiKey } = config();
    const response = await fetch(`${IDENTITY_API}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const error = authError(payload, response.statusText, response.status);
      if (error.code !== "INVALID_CREDENTIALS") throw error;
    }
    return { resetEmailSent: true };
  }

  async function storedAuth() {
    const stored = await chrome.storage.local.get(AUTH_STORAGE_KEY);
    const value = stored[AUTH_STORAGE_KEY];
    return value?.refreshToken && value?.uid ? value : null;
  }

  async function refreshSession() {
    const { apiKey } = config();
    const stored = await storedAuth();
    if (!stored) throw new CloudError("AUTH_REQUIRED", "Sign in to Firebase to continue");
    const response = await fetch(`${TOKEN_API}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: stored.refreshToken })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      await signOut();
      throw authError(payload, response.statusText, response.status);
    }
    return saveSession(payload, stored.email);
  }

  async function session(forceRefresh = false) {
    if (!forceRefresh && currentSession?.idToken && currentSession.expiresAt - Date.now() > 60_000) return currentSession;
    return refreshSession();
  }

  function emptyState() {
    const now = Date.now();
    return {
      active: LaterTubeCloudState.createDocument([], now),
      history: LaterTubeCloudState.createDocument([], now)
    };
  }

  function normalizeRoot(value) {
    const fallback = emptyState();
    return LaterTubeCloudState.reconcile(
      value?.active || fallback.active,
      value?.history || fallback.history
    );
  }

  function statePayload(state, updatedAt = Date.now()) {
    return {
      format: "LaterTube Firebase state",
      schemaVersion: 1,
      updatedAt,
      active: state.active,
      history: state.history
    };
  }

  async function databaseRequest(method, body, etag, retryAuth = true, path = "") {
    const configuration = config();
    const auth = await session();
    const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
    const url = `${configuration.databaseUrl}/users/${encodeURIComponent(auth.uid)}${suffix}.json?auth=${encodeURIComponent(auth.idToken)}`;
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (method === "GET") headers["X-Firebase-ETag"] = "true";
    if (etag) headers["If-Match"] = etag;
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if ((response.status === 401 || response.status === 403) && retryAuth) {
      await session(true);
      return databaseRequest(method, body, etag, false, path);
    }
    if (response.status === 412) {
      throw new CloudError("CLOUD_CONFLICT", "Firebase state changed on another device", 412);
    }
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const message = String(payload?.error || response.statusText || "Firebase request failed");
      const code = response.status === 401 || response.status === 403 ? "AUTH_REQUIRED"
        : response.status === 404 ? "FIREBASE_DATABASE_MISSING"
          : "CLOUD_REQUEST_FAILED";
      throw new CloudError(code, message, response.status);
    }
    return { payload, etag: response.headers.get("etag") || "", uid: auth.uid };
  }

  async function readCloudState() {
    const response = await databaseRequest("GET");
    return {
      state: normalizeRoot(response.payload),
      etag: response.etag,
      uid: response.uid,
      updatedAt: Number(response.payload?.updatedAt) || 0
    };
  }

  async function writeCloudState(snapshot, state, updatedAt) {
    await databaseRequest("PUT", statePayload(state, updatedAt), snapshot.etag);
  }

  function operationMarker() {
    return {
      now: Date.now(),
      changeId: globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    };
  }

  async function retryMutation(callback) {
    const operation = operationMarker();
    let lastError;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const snapshot = await readCloudState();
        const next = callback(snapshot.state, operation);
        await writeCloudState(snapshot, next, operation.now);
        return { ...next, updatedAt: operation.now };
      } catch (error) {
        lastError = error;
        if (error?.code !== "CLOUD_CONFLICT" || attempt === MAX_RETRIES - 1) throw error;
      }
    }
    throw lastError;
  }

  async function addVideos(videos) {
    const next = await retryMutation((state, operation) => LaterTubeCloudState.addOrRestore(state, videos, operation));
    return { results: next.results, active: next.active.videos, history: next.history.videos, updatedAt: next.updatedAt };
  }

  async function archiveVideos(ids) {
    const next = await retryMutation((state, operation) => LaterTubeCloudState.archive(state, ids, operation));
    return { archivedIds: next.archivedIds, active: next.active.videos, history: next.history.videos, updatedAt: next.updatedAt };
  }

  async function restoreVideos(ids) {
    const next = await retryMutation((state, operation) => LaterTubeCloudState.restore(state, ids, operation));
    return { restoredIds: next.restoredIds, active: next.active.videos, history: next.history.videos, updatedAt: next.updatedAt };
  }

  async function deleteHistoryVideos(ids) {
    const next = await retryMutation((state, operation) => LaterTubeCloudState.deleteHistory(state, ids, operation));
    return { deletedIds: next.deletedIds, active: next.active.videos, history: next.history.videos, updatedAt: next.updatedAt };
  }

  async function clearActive() {
    const next = await retryMutation((state, operation) => {
      const ids = state.active.videos.map(video => video.id);
      return LaterTubeCloudState.archive(state, ids, operation);
    });
    return { archivedIds: next.archivedIds, active: next.active.videos, history: next.history.videos, updatedAt: next.updatedAt };
  }

  async function updateActiveVideos(transform) {
    const next = await retryMutation((state, operation) => ({
      active: LaterTubeCloudState.createDocument(transform(state.active.videos).map(video => ({
        ...video,
        updatedAt: operation.now,
        changeId: operation.changeId
      })), operation.now),
      history: state.history
    }));
    return { active: next.active.videos, history: next.history.videos, updatedAt: next.updatedAt };
  }

  async function getState() {
    const snapshot = await readCloudState();
    return {
      active: snapshot.state.active.videos,
      history: snapshot.state.history.videos,
      updatedAt: snapshot.updatedAt,
      uid: snapshot.uid
    };
  }

  async function getStateIfChanged(cachedUpdatedAt) {
    const localVersion = Number(cachedUpdatedAt) || 0;
    if (!localVersion) return getState();
    const versionResponse = await databaseRequest("GET", undefined, undefined, true, "updatedAt");
    const cloudVersion = Number(versionResponse.payload) || 0;
    if (cloudVersion && cloudVersion === localVersion) {
      return { notModified: true, updatedAt: cloudVersion, uid: versionResponse.uid };
    }
    return getState();
  }

  async function getAuthStatus() {
    const stored = await storedAuth();
    return { signedIn: Boolean(stored), email: stored?.email || "", uid: stored?.uid || "" };
  }

  async function signOut() {
    currentSession = null;
    await chrome.storage.local.remove(AUTH_STORAGE_KEY);
    return { signedOut: true };
  }

  root.LaterTubeFirebase = {
    CloudError,
    addVideos,
    archiveVideos,
    authenticate,
    clearActive,
    deleteHistoryVideos,
    getAuthStatus,
    getState,
    getStateIfChanged,
    readCloudState,
    requestPasswordReset,
    restoreVideos,
    signOut,
    updateActiveVideos
  };
})(globalThis);
