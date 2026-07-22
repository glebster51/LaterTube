const STORAGE_KEY = "watchLaterVideos";
const COLLECT_MENU_ID = "collect-youtube-tabs";
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: COLLECT_MENU_ID,
      title: t("collectTabs"),
      contexts: ["action"]
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: COLLECT_MENU_ID,
      title: t("collectTabs"),
      contexts: ["action"]
    });
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("list.html") });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === COLLECT_MENU_ID) {
    collectYouTubeTabs();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ADD_VIDEO") {
    addVideos([message.video]).then(([result]) => sendResponse(result));
    return true;
  }

  if (message?.type === "HAS_VIDEO") {
    getVideos().then((videos) => {
      sendResponse({ saved: videos.some((video) => video.id === message.videoId) });
    });
    return true;
  }

  if (message?.type === "OPEN_LIST") {
    chrome.tabs.create({ url: chrome.runtime.getURL("list.html") });
  }

});

function hasViewCount(value) {
  if (value === null || value === undefined || value === "") return false;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0;
}

async function collectYouTubeTabs() {
  const tabs = await chrome.tabs.query({});
  const collected = tabs
    .map(videoFromTab)
    .filter(Boolean);

  if (!collected.length) {
    await setBadge("0", "#777777");
    return;
  }

  const results = await addVideos(collected.map(({ video }) => video));
  const tabIds = collected.map(({ tabId }) => tabId).filter(Number.isInteger);

  if (tabIds.length) {
    await chrome.tabs.remove(tabIds);
  }

  const addedCount = results.filter((result) => result.added).length;
  await setBadge(String(addedCount), addedCount ? "#2ba640" : "#777777");
}

function videoFromTab(tab) {
  const id = extractVideoId(tab.url);
  if (!id) return null;

  const rawTitle = (tab.title || t("videoFallback")).replace(/\s*-\s*YouTube\s*$/i, "").trim();
  return {
    tabId: tab.id,
    video: normalizeVideo({
      id,
      title: rawTitle || t("videoFallback"),
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    })
  };
}

function extractVideoId(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "youtu.be") return validId(url.pathname.slice(1));
    if (!url.hostname.endsWith("youtube.com")) return null;
    if (url.pathname === "/watch") return validId(url.searchParams.get("v"));
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/);
    return validId(match?.[1]);
  } catch {
    return null;
  }
}

function validId(value) {
  return /^[a-zA-Z0-9_-]{6,20}$/.test(value || "") ? value : null;
}

function normalizeVideo(video) {
  return {
    id: video.id,
    title: video.title || t("videoFallback"),
    url: `https://www.youtube.com/watch?v=${video.id}`,
    thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    channel: video.channel || "",
    durationSeconds: normalizeDuration(video.durationSeconds),
    publishedAt: normalizeTimestamp(video.publishedAt),
    viewCount: normalizeViewCount(video.viewCount),
    addedAt: video.addedAt || Date.now()
  };
}

function normalizeDuration(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : null;
}

function normalizeViewCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
}

async function addVideos(incoming) {
  const videos = await getVideos();
  const knownIds = new Set(videos.map((video) => video.id));
  const results = [];
  const prepared = await mapWithConcurrency(incoming, 3, completeVideoMetadata);

  for (const candidate of prepared) {
    if (!candidate?.id) {
      results.push({ added: false, error: "invalid-video" });
      continue;
    }

    if (knownIds.has(candidate.id)) {
      const index = videos.findIndex((video) => video.id === candidate.id);
      if (index >= 0) {
        const normalized = normalizeVideo(candidate);
        videos[index] = {
          ...videos[index],
          channel: videos[index].channel || normalized.channel,
          durationSeconds: videos[index].durationSeconds || normalized.durationSeconds,
          publishedAt: videos[index].publishedAt || normalized.publishedAt,
          viewCount: hasViewCount(videos[index].viewCount) ? videos[index].viewCount : normalized.viewCount
        };
      }
      results.push({ added: false, duplicate: true });
      continue;
    }

    const video = normalizeVideo(candidate);
    videos.unshift(video);
    knownIds.add(video.id);
    results.push({ added: true, video });
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: videos });
  return results;
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
      durationSeconds: normalizeDuration(details.lengthSeconds),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
      viewCount: normalizeViewCount(details.viewCount),
      thumbnail: details.thumbnail?.thumbnails?.at(-1)?.url || null
    };
  } catch {
    return null;
  }
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
      try {
        return JSON.parse(text.slice(objectStart, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function getVideos() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000);
}
