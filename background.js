try { importScripts("firebase-config.local.js"); } catch { }
importScripts("cloud-state.js", "firebase-client.js");

const COLLECT_MENU_ID = "collect-youtube-tabs";
const STATE_CACHE_MS = 15_000;
const STATE_CACHE_KEY = "firebaseStateCacheV1";
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
let stateCache = null;
let stateCachedAt = 0;
let stateCacheHydrated = false;

chrome.runtime.onInstalled.addListener(createContextMenu);
chrome.runtime.onStartup.addListener(createContextMenu);

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: COLLECT_MENU_ID,
      title: t("collectTabs"),
      contexts: ["action"]
    });
  });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("list.html") });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === COLLECT_MENU_ID) void collectYouTubeTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = promise => {
    promise.then(sendResponse).catch(error => sendResponse({ error: cloudError(error) }));
    return true;
  };

  if (message?.type === "FIREBASE_SIGN_IN") {
    return respond(LaterTubeFirebase.authenticate(message.email, message.password, false).then(cacheState));
  }
  if (message?.type === "FIREBASE_SIGN_UP") {
    return respond(LaterTubeFirebase.authenticate(message.email, message.password, true).then(cacheState));
  }
  if (message?.type === "FIREBASE_PASSWORD_RESET") {
    return respond(LaterTubeFirebase.requestPasswordReset(message.email));
  }
  if (message?.type === "GET_AUTH_STATUS") {
    return respond(LaterTubeFirebase.getAuthStatus());
  }
  if (message?.type === "GET_CACHED_STATE") {
    return respond(getCachedState());
  }
  if (message?.type === "GET_CLOUD_STATE") {
    return respond(getCloudState(Boolean(message.force)));
  }
  if (message?.type === "ADD_VIDEO") {
    return respond(addVideos([message.video]).then(([result]) => result));
  }
  if (message?.type === "HAS_VIDEO") {
    return respond(getCloudState(false).then(state => ({
      saved: state.active.some(video => video.id === message.videoId)
    })));
  }
  if (message?.type === "ARCHIVE_VIDEO") {
    return respond(LaterTubeFirebase.archiveVideos([message.videoId]).then(async result => {
      await cacheState(result);
      return { archived: result.archivedIds.includes(message.videoId), ...result };
    }));
  }
  if (message?.type === "RESTORE_VIDEO") {
    return respond(LaterTubeFirebase.restoreVideos([message.videoId]).then(async result => {
      await cacheState(result);
      return { restored: result.restoredIds.includes(message.videoId), ...result };
    }));
  }
  if (message?.type === "DELETE_HISTORY_VIDEO") {
    return respond(LaterTubeFirebase.deleteHistoryVideos([message.videoId]).then(async result => {
      await cacheState(result);
      return { deleted: result.deletedIds.includes(message.videoId), ...result };
    }));
  }
  if (message?.type === "CLEAR_ACTIVE") {
    return respond(LaterTubeFirebase.clearActive().then(cacheState));
  }
  if (message?.type === "IMPORT_VIDEOS") {
    return respond(addVideos(Array.isArray(message.videos) ? message.videos : []).then(results => ({ results })));
  }
  if (message?.type === "ENRICH_INCOMPLETE_VIDEOS") {
    return respond(enrichIncompleteVideos());
  }
  if (message?.type === "SIGN_OUT_FIREBASE") {
    return respond(LaterTubeFirebase.signOut().then(async () => {
      stateCache = null;
      stateCachedAt = 0;
      stateCacheHydrated = true;
      await chrome.storage.local.remove(STATE_CACHE_KEY);
      return { signedOut: true };
    }));
  }
  if (message?.type === "OPEN_LIST") {
    chrome.tabs.create({ url: chrome.runtime.getURL("list.html") });
  }
});

function cloudError(error) {
  return {
    code: error?.code || "CLOUD_ERROR",
    message: String(error?.message || error || "Firebase error")
  };
}

async function hydrateStateCache() {
  if (stateCacheHydrated) return;
  stateCacheHydrated = true;
  const stored = await chrome.storage.local.get(STATE_CACHE_KEY);
  const value = stored[STATE_CACHE_KEY];
  if (!value || !Array.isArray(value.active) || !Array.isArray(value.history) || !value.uid) return;
  stateCache = value;
  stateCachedAt = Number(value.cachedAt) || 0;
}

async function getCachedState() {
  await hydrateStateCache();
  const auth = await LaterTubeFirebase.getAuthStatus();
  if (!auth.signedIn || !stateCache || stateCache.uid !== auth.uid) return null;
  return { ...stateCache, fromCache: true };
}

async function cacheState(result) {
  const auth = await LaterTubeFirebase.getAuthStatus();
  stateCache = {
    active: Array.isArray(result?.active) ? result.active : [],
    history: Array.isArray(result?.history) ? result.history : [],
    updatedAt: Number(result?.updatedAt) || Date.now(),
    uid: result?.uid || auth.uid,
    cachedAt: Date.now()
  };
  stateCachedAt = stateCache.cachedAt;
  stateCacheHydrated = true;
  await chrome.storage.local.set({ [STATE_CACHE_KEY]: stateCache });
  await chrome.storage.local.remove("watchLaterVideos");
  return stateCache;
}

async function getCloudState(force) {
  await hydrateStateCache();
  const auth = await LaterTubeFirebase.getAuthStatus();
  if (stateCache && stateCache.uid !== auth.uid) {
    stateCache = null;
    stateCachedAt = 0;
    await chrome.storage.local.remove(STATE_CACHE_KEY);
  }
  if (!force && stateCache && Date.now() - stateCachedAt < STATE_CACHE_MS) return stateCache;
  if (stateCache?.updatedAt) {
    const result = await LaterTubeFirebase.getStateIfChanged(stateCache.updatedAt);
    if (result.notModified) {
      stateCachedAt = Date.now();
      stateCache.cachedAt = stateCachedAt;
      await chrome.storage.local.set({ [STATE_CACHE_KEY]: stateCache });
      return { ...stateCache, notModified: true };
    }
    return cacheState(result);
  }
  return cacheState(await LaterTubeFirebase.getState());
}

async function collectYouTubeTabs() {
  const tabs = await chrome.tabs.query({});
  const collected = tabs.map(videoFromTab).filter(Boolean);
  if (!collected.length) {
    await setBadge("0", "#777777");
    return;
  }

  try {
    const results = await addVideos(collected.map(({ video }) => video));
    const tabIds = collected.map(({ tabId }) => tabId).filter(Number.isInteger);
    if (tabIds.length) await chrome.tabs.remove(tabIds);
    const addedCount = results.filter(result => result.added || result.restored).length;
    await setBadge(String(addedCount), addedCount ? "#2ba640" : "#777777");
  } catch {
    await setBadge("!", "#cc3344");
  }
}

function videoFromTab(tab) {
  const id = LaterTubeCloudState.extractVideoId(tab.url);
  if (!id) return null;
  const rawTitle = (tab.title || t("videoFallback")).replace(/\s*-\s*YouTube\s*$/i, "").trim();
  return {
    tabId: tab.id,
    video: normalizeVideo({
      id,
      title: rawTitle || t("videoFallback"),
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    })
  };
}

function normalizeVideo(video) {
  return LaterTubeCloudState.normalizeVideo({
    ...video,
    title: video?.title || t("videoFallback")
  });
}

function hasViewCount(value) {
  if (value === null || value === undefined || value === "") return false;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0;
}

async function addVideos(incoming) {
  const prepared = await mapWithConcurrency(incoming, 3, completeVideoMetadata);
  const result = await LaterTubeFirebase.addVideos(prepared);
  await cacheState(result);
  return result.results;
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function completeVideoMetadata(candidate) {
  if (!candidate?.id) return candidate;
  const video = normalizeVideo(candidate);
  const metadata = await fetchVideoMetadata(video.id);
  if (!metadata) return video;
  return normalizeVideo({
    ...video,
    title: metadata.title || video.title,
    channel: metadata.channel || video.channel,
    durationSeconds: metadata.durationSeconds || video.durationSeconds,
    publishedAt: metadata.publishedAt || video.publishedAt,
    viewCount: hasViewCount(metadata.viewCount) ? metadata.viewCount : video.viewCount,
    thumbnail: metadata.thumbnail || video.thumbnail
  });
}

async function fetchVideoMetadata(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: "omit"
    });
    if (!response.ok) return null;
    const playerResponse = extractPlayerResponse(await response.text());
    const details = playerResponse?.videoDetails;
    if (details?.videoId !== videoId) return null;
    const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {};
    const publishedAt = Date.parse(microformat.publishDate || microformat.uploadDate || "");
    return {
      title: details.title,
      channel: details.author,
      durationSeconds: positiveNumber(details.lengthSeconds),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
      viewCount: nullableCount(details.viewCount),
      thumbnail: details.thumbnail?.thumbnails?.at(-1)?.url || null
    };
  } catch {
    return null;
  }
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function nullableCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function extractPlayerResponse(html) {
  const markers = ["var ytInitialPlayerResponse =", "ytInitialPlayerResponse =", "\"playerResponse\":"];
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const parsed = extractJsonObject(html, markerIndex + marker.length);
    if (parsed?.videoDetails) return parsed;
  }
  return null;
}

function extractJsonObject(text, startIndex) {
  const objectStart = text.indexOf("{", startIndex);
  if (objectStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(objectStart, index + 1)); }
      catch { return null; }
    }
  }
  return null;
}

function isMissingText(value) {
  return typeof value !== "string" || !value.trim();
}

function isMissingTitle(value) {
  return isMissingText(value) || ["YouTube video", "Видео YouTube", "Video de YouTube"].includes(value.trim());
}

function needsMetadata(video) {
  return isMissingTitle(video.title)
    || isMissingText(video.channel)
    || !positiveNumber(video.durationSeconds)
    || !positiveNumber(video.publishedAt)
    || !hasViewCount(video.viewCount)
    || isMissingText(video.thumbnail);
}

async function enrichIncompleteVideos() {
  const state = await getCloudState(true);
  const incomplete = state.active.filter(needsMetadata);
  if (!incomplete.length) return { checked: 0, updated: 0, failed: 0 };
  const fetched = await mapWithConcurrency(incomplete, 3, video => fetchVideoMetadata(video.id));
  const metadataById = new Map(incomplete.map((video, index) => [video.id, fetched[index]]));
  let updated = 0;
  const result = await LaterTubeFirebase.updateActiveVideos(videos => videos.map(video => {
    const metadata = metadataById.get(video.id);
    if (!metadata) return video;
    const merged = LaterTubeCloudState.mergeMetadata(video, normalizeVideo({ ...video, ...metadata }));
    if (merged !== video) updated++;
    return merged;
  }));
  await cacheState(result);
  return {
    checked: incomplete.length,
    updated,
    failed: incomplete.length - fetched.filter(Boolean).length
  };
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
}
