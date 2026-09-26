(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.LaterTubeCloudState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FORMAT = "LaterTube cloud list";
  const SCHEMA_VERSION = 1;

  function validVideoId(value) {
    return /^[a-zA-Z0-9_-]{6,20}$/.test(value || "") ? value : null;
  }

  function numberOrNull(value, positiveOnly = false) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || (positiveOnly && number <= 0)) return null;
    return Math.round(number);
  }

  function timestamp(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
  }

  function normalizeVideo(video, now = Date.now()) {
    if (!video || typeof video !== "object") return null;
    const id = validVideoId(video.id) || extractVideoId(video.url);
    if (!id) return null;
    const addedAt = timestamp(video.addedAt, now);
    const updatedAt = timestamp(video.updatedAt, addedAt);
    return {
      id,
      title: typeof video.title === "string" && video.title.trim() ? video.title.trim() : "YouTube video",
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: typeof video.thumbnail === "string" && video.thumbnail
        ? video.thumbnail
        : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      channel: typeof video.channel === "string" ? video.channel : "",
      durationSeconds: numberOrNull(video.durationSeconds, true),
      publishedAt: numberOrNull(video.publishedAt, true),
      viewCount: numberOrNull(video.viewCount),
      addedAt,
      updatedAt,
      changeId: typeof video.changeId === "string" ? video.changeId : ""
    };
  }

  function normalizeHistoryVideo(video, now = Date.now()) {
    const normalized = normalizeVideo(video, now);
    if (!normalized) return null;
    return {
      ...normalized,
      removedAt: timestamp(video.removedAt, normalized.updatedAt)
    };
  }

  function extractVideoId(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      if (url.hostname === "youtu.be") return validVideoId(url.pathname.slice(1));
      if (!url.hostname.endsWith("youtube.com")) return null;
      if (url.pathname === "/watch") return validVideoId(url.searchParams.get("v"));
      return validVideoId(url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1]);
    } catch {
      return null;
    }
  }

  function compareRevision(a, b) {
    const timeDifference = timestamp(a?.updatedAt) - timestamp(b?.updatedAt);
    if (timeDifference) return timeDifference;
    return String(a?.changeId || "").localeCompare(String(b?.changeId || ""));
  }

  function uniqueVideos(videos, history, now) {
    const byId = new Map();
    for (const value of Array.isArray(videos) ? videos : []) {
      const video = history ? normalizeHistoryVideo(value, now) : normalizeVideo(value, now);
      if (!video) continue;
      const existing = byId.get(video.id);
      if (!existing || compareRevision(video, existing) > 0) byId.set(video.id, video);
    }
    return [...byId.values()];
  }

  function createDocument(videos, updatedAt = Date.now()) {
    return {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: timestamp(updatedAt, Date.now()),
      videos
    };
  }

  function normalizeDocument(document, history = false, now = Date.now()) {
    const videos = uniqueVideos(document?.videos, history, now);
    return createDocument(videos, timestamp(document?.updatedAt, now));
  }

  function reconcile(activeDocument, historyDocument, now = Date.now()) {
    const active = normalizeDocument(activeDocument, false, now);
    const history = normalizeDocument(historyDocument, true, now);
    const activeById = new Map(active.videos.map((video) => [video.id, video]));
    const historyById = new Map(history.videos.map((video) => [video.id, video]));

    for (const [id, activeVideo] of activeById) {
      const historyVideo = historyById.get(id);
      if (!historyVideo) continue;
      if (compareRevision(activeVideo, historyVideo) > 0) historyById.delete(id);
      else activeById.delete(id);
    }

    return {
      active: createDocument([...activeById.values()], active.updatedAt),
      history: createDocument([...historyById.values()], history.updatedAt)
    };
  }

  function marker(options = {}) {
    return {
      now: timestamp(options.now, Date.now()),
      changeId: typeof options.changeId === "string" && options.changeId
        ? options.changeId
        : randomChangeId()
    };
  }

  function randomChangeId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function addOrRestore(state, incoming, options = {}) {
    const operation = marker(options);
    const next = reconcile(state.active, state.history, operation.now);
    const activeById = new Map(next.active.videos.map((video) => [video.id, video]));
    const historyById = new Map(next.history.videos.map((video) => [video.id, video]));
    const results = [];

    for (const candidate of Array.isArray(incoming) ? incoming : []) {
      const normalized = normalizeVideo(candidate, operation.now);
      if (!normalized) {
        results.push({ added: false, error: "invalid-video" });
        continue;
      }

      const existing = activeById.get(normalized.id);
      const restored = historyById.has(normalized.id);
      if (existing && !restored) {
        const merged = mergeMetadata(existing, normalized);
        const saved = merged === existing ? existing : {
          ...merged,
          updatedAt: operation.now,
          changeId: operation.changeId
        };
        activeById.set(normalized.id, saved);
        results.push({ added: false, duplicate: true, video: saved });
        continue;
      }

      const base = existing || historyById.get(normalized.id) || normalized;
      const video = {
        ...base,
        title: candidate.title ? normalized.title : base.title,
        thumbnail: candidate.thumbnail ? normalized.thumbnail : base.thumbnail,
        channel: candidate.channel ? normalized.channel : base.channel,
        durationSeconds: candidate.durationSeconds ? normalized.durationSeconds : base.durationSeconds,
        publishedAt: candidate.publishedAt ? normalized.publishedAt : base.publishedAt,
        viewCount: candidate.viewCount !== null && candidate.viewCount !== undefined && candidate.viewCount !== ""
          ? normalized.viewCount
          : base.viewCount,
        addedAt: operation.now,
        updatedAt: operation.now,
        changeId: operation.changeId
      };
      delete video.removedAt;
      activeById.set(video.id, video);
      historyById.delete(video.id);
      results.push({ added: !restored, restored, video });
    }

    return {
      active: createDocument([...activeById.values()], operation.now),
      history: createDocument([...historyById.values()], operation.now),
      results
    };
  }

  function archive(state, ids, options = {}) {
    const operation = marker(options);
    const next = reconcile(state.active, state.history, operation.now);
    const activeById = new Map(next.active.videos.map((video) => [video.id, video]));
    const historyById = new Map(next.history.videos.map((video) => [video.id, video]));
    const archivedIds = [];

    for (const id of new Set(Array.isArray(ids) ? ids : [])) {
      const video = activeById.get(id);
      if (!video) continue;
      historyById.set(id, {
        ...video,
        removedAt: operation.now,
        updatedAt: operation.now,
        changeId: operation.changeId
      });
      activeById.delete(id);
      archivedIds.push(id);
    }

    return {
      active: createDocument([...activeById.values()], operation.now),
      history: createDocument([...historyById.values()], operation.now),
      archivedIds
    };
  }

  function restore(state, ids, options = {}) {
    const operation = marker(options);
    const next = reconcile(state.active, state.history, operation.now);
    const activeById = new Map(next.active.videos.map((video) => [video.id, video]));
    const historyById = new Map(next.history.videos.map((video) => [video.id, video]));
    const restoredIds = [];

    for (const id of new Set(Array.isArray(ids) ? ids : [])) {
      const video = historyById.get(id);
      if (!video) continue;
      const restored = {
        ...video,
        addedAt: operation.now,
        updatedAt: operation.now,
        changeId: operation.changeId
      };
      delete restored.removedAt;
      activeById.set(id, restored);
      historyById.delete(id);
      restoredIds.push(id);
    }

    return {
      active: createDocument([...activeById.values()], operation.now),
      history: createDocument([...historyById.values()], operation.now),
      restoredIds
    };
  }

  function deleteHistory(state, ids, options = {}) {
    const operation = marker(options);
    const next = reconcile(state.active, state.history, operation.now);
    const historyById = new Map(next.history.videos.map((video) => [video.id, video]));
    const deletedIds = [];

    for (const id of new Set(Array.isArray(ids) ? ids : [])) {
      if (!historyById.delete(id)) continue;
      deletedIds.push(id);
    }

    return {
      active: createDocument(next.active.videos, operation.now),
      history: createDocument([...historyById.values()], operation.now),
      deletedIds
    };
  }

  function mergeMetadata(existing, incoming) {
    const next = { ...existing };
    let changed = false;
    const take = (key, missing) => {
      if (missing(next[key]) && !missing(incoming[key])) {
        next[key] = incoming[key];
        changed = true;
      }
    };
    take("title", value => !value || value === "YouTube video");
    take("channel", value => !value);
    take("thumbnail", value => !value);
    take("durationSeconds", value => !(Number(value) > 0));
    take("publishedAt", value => !(Number(value) > 0));
    take("viewCount", value => value === null || value === undefined || value === "");
    return changed ? next : existing;
  }

  return {
    FORMAT,
    SCHEMA_VERSION,
    addOrRestore,
    archive,
    compareRevision,
    createDocument,
    deleteHistory,
    extractVideoId,
    mergeMetadata,
    normalizeDocument,
    normalizeHistoryVideo,
    normalizeVideo,
    reconcile,
    restore,
    validVideoId
  };
});
