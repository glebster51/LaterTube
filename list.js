const STORAGE_KEY = "watchLaterVideos";
const REMOVE_ON_PLAY_KEY = "removeOnPlay";
const NATIVE_HOST_NAME = "com.glebster51.latertube_usb_sync";
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
const uiLanguage = chrome.i18n.getUILanguage();
const grid = document.querySelector("#grid");
const empty = document.querySelector("#empty");
const counter = document.querySelector("#counter");
const search = document.querySelector("#search");
const sort = document.querySelector("#sort");
const clearAll = document.querySelector("#clear-all");
const exportList = document.querySelector("#export-list");
const importList = document.querySelector("#import-list");
const importFile = document.querySelector("#import-file");
const removeOnPlayToggle = document.querySelector("#remove-on-play");
const syncPhone = document.querySelector("#sync-phone");
const syncStatus = document.querySelector("#sync-status");
const metadataStatus = document.querySelector("#metadata-status");
const template = document.querySelector("#card-template");
const supportDialog = document.querySelector("#support-dialog");
const copyStatus = document.querySelector("#copy-status");

let videos = [];
let removeOnPlay = false;
const randomRanks = new Map();

localizePage();
loadState();
search.addEventListener("input", render);
sort.addEventListener("change", render);
clearAll.addEventListener("click", clearVideos);
exportList.addEventListener("click", exportVideos);
importList.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importVideos);
removeOnPlayToggle.addEventListener("change", saveRemoveOnPlay);
syncPhone.addEventListener("click", syncWithPhone);
document.querySelector("#open-support").addEventListener("click", () => supportDialog.showModal());
document.querySelector("#close-support").addEventListener("click", () => supportDialog.close());
supportDialog.addEventListener("click", (event) => {
  if (event.target === supportDialog) supportDialog.close();
});
document.querySelectorAll(".copy-address").forEach((button) => {
  button.addEventListener("click", () => copyWalletAddress(button));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes[STORAGE_KEY]) {
    videos = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
    refreshRandomRanks();
    render();
  }

  if (changes[REMOVE_ON_PLAY_KEY]) {
    removeOnPlay = changes[REMOVE_ON_PLAY_KEY].newValue === true;
    removeOnPlayToggle.checked = removeOnPlay;
  }
});

async function copyWalletAddress(button) {
  const address = button.dataset.address;
  try {
    await navigator.clipboard.writeText(address);
    copyStatus.textContent = t("addressCopied");
    const originalLabel = button.textContent;
    button.textContent = t("copied");
    setTimeout(() => {
      button.textContent = originalLabel;
      copyStatus.textContent = "";
    }, 2500);
  } catch {
    copyStatus.textContent = t("copyFailed");
  }
}

function localizePage() {
  document.documentElement.lang = uiLanguage;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.alt = t(element.dataset.i18nAlt);
  });
  clearAll.dataset.shortLabel = t("clearShort");
}

async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, REMOVE_ON_PLAY_KEY]);
  videos = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  refreshRandomRanks(true);
  removeOnPlay = stored[REMOVE_ON_PLAY_KEY] === true;
  removeOnPlayToggle.checked = removeOnPlay;
  render();
  void enrichIncompleteMetadata();
}

function needsMetadata(video) {
  const missingText = (value) => typeof value !== "string" || !value.trim();
  const missingTitle = missingText(video.title)
    || ["YouTube video", "Видео YouTube", "Video de YouTube"].includes(video.title.trim());
  const hasDuration = Number.isFinite(Number(video.durationSeconds)) && Number(video.durationSeconds) > 0;
  const hasTimestamp = Number.isFinite(Number(video.publishedAt)) && Number(video.publishedAt) > 0;
  return missingTitle || missingText(video.channel) || !hasDuration || !hasTimestamp
    || !hasViewCount(video.viewCount) || missingText(video.thumbnail);
}

async function enrichIncompleteMetadata() {
  const incompleteCount = videos.filter(needsMetadata).length;
  if (!incompleteCount) return;

  metadataStatus.textContent = t("metadataLoading", [String(incompleteCount)]);
  try {
    const result = await chrome.runtime.sendMessage({ type: "ENRICH_INCOMPLETE_VIDEOS" });
    if (result?.error) throw new Error(result.error);
    metadataStatus.textContent = result?.updated
      ? t("metadataUpdated", [String(result.updated), String(result.checked)])
      : t("metadataNotFound", [String(result?.checked || incompleteCount)]);
  } catch {
    metadataStatus.textContent = t("metadataFailed");
  }
}

function render() {
  const query = search.value.trim().toLocaleLowerCase("ru");
  const visible = videos
    .filter((video) => !query || `${video.title} ${video.channel || ""}`.toLocaleLowerCase("ru").includes(query))
    .sort(sortVideos);

  grid.replaceChildren(...visible.map(createCard));
  const counterParts = [t("videoCount", [String(videos.length)])];
  const totalDuration = videos.reduce((total, video) => {
    const duration = Number(video.durationSeconds);
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  if (totalDuration > 0) {
    counterParts.push(t("totalDuration", [formatTotalDuration(totalDuration)]));
  }
  if (query) counterParts.push(t("foundCount", [String(visible.length)]));
  counter.textContent = counterParts.join(" · ");
  empty.hidden = videos.length !== 0;
  grid.hidden = videos.length === 0;
  clearAll.hidden = videos.length === 0;
}

function createCard(video) {
  const card = template.content.firstElementChild.cloneNode(true);
  const links = card.querySelectorAll(".thumbnail-link, .video-title");
  links.forEach((link) => {
    link.href = video.url;
    link.addEventListener("click", () => handleVideoOpen(video.id));
  });

  const image = card.querySelector(".thumbnail");
  image.src = video.thumbnail;
  image.alt = t("thumbnailAlt", [video.title]);
  image.addEventListener("error", () => {
    image.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
  }, { once: true });

  const duration = card.querySelector(".duration");
  if (video.durationSeconds) {
    duration.textContent = formatDuration(video.durationSeconds);
    duration.hidden = false;
  }

  const title = card.querySelector(".video-title");
  title.textContent = video.title;
  title.title = video.title;

  const channel = card.querySelector(".channel");
  channel.textContent = video.channel || "YouTube";

  const viewCount = card.querySelector(".view-count");
  if (hasViewCount(video.viewCount)) {
    viewCount.textContent = t("viewsLabel", [formatViewCount(video.viewCount)]);
  } else {
    viewCount.hidden = true;
  }
  const publishedDate = card.querySelector(".published-date");
  if (video.publishedAt) {
    publishedDate.textContent = t("publishedDate", [formatDate(video.publishedAt)]);
  } else {
    publishedDate.hidden = true;
  }
  card.querySelector(".added-date").textContent = t("addedDate", [formatDate(video.addedAt)]);
  card.querySelector(".remove-button").addEventListener("click", () => removeVideo(video.id));
  return card;
}

function sortVideos(a, b) {
  if (sort.value === "added-oldest") return (a.addedAt || 0) - (b.addedAt || 0);
  if (sort.value === "video-newest") return compareTimestamp(a.publishedAt, b.publishedAt, -1);
  if (sort.value === "video-oldest") return compareTimestamp(a.publishedAt, b.publishedAt, 1);
  if (sort.value === "views-most") return compareViews(a.viewCount, b.viewCount, -1);
  if (sort.value === "views-least") return compareViews(a.viewCount, b.viewCount, 1);
  if (sort.value === "random") return (randomRanks.get(a.id) || 0) - (randomRanks.get(b.id) || 0);
  if (sort.value === "title") return a.title.localeCompare(b.title, uiLanguage);
  if (sort.value === "shortest") return compareDuration(a, b, 1);
  if (sort.value === "longest") return compareDuration(a, b, -1);
  return (b.addedAt || 0) - (a.addedAt || 0);
}

function compareViews(a, b, direction) {
  const aKnown = hasViewCount(a);
  const bKnown = hasViewCount(b);
  if (!aKnown && !bKnown) return 0;
  if (!aKnown) return 1;
  if (!bKnown) return -1;
  return (Number(a) - Number(b)) * direction;
}

function hasViewCount(value) {
  if (value === null || value === undefined || value === "") return false;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0;
}

function refreshRandomRanks(reset = false) {
  if (reset) randomRanks.clear();
  videos.forEach((video) => {
    if (!randomRanks.has(video.id)) randomRanks.set(video.id, Math.random());
  });
}

function formatViewCount(value) {
  return new Intl.NumberFormat(uiLanguage, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function compareTimestamp(a, b, direction) {
  const aTimestamp = Number(a) || null;
  const bTimestamp = Number(b) || null;
  if (aTimestamp === null && bTimestamp === null) return 0;
  if (aTimestamp === null) return 1;
  if (bTimestamp === null) return -1;
  return (aTimestamp - bTimestamp) * direction;
}

function compareDuration(a, b, direction) {
  const aDuration = Number(a.durationSeconds) || null;
  const bDuration = Number(b.durationSeconds) || null;
  if (aDuration === null && bDuration === null) return 0;
  if (aDuration === null) return 1;
  if (bDuration === null) return -1;
  return (aDuration - bDuration) * direction;
}

async function removeVideo(id) {
  videos = videos.filter((video) => video.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: videos });
}

function handleVideoOpen(id) {
  if (!removeOnPlay) return;
  removeVideo(id);
}

async function saveRemoveOnPlay() {
  removeOnPlay = removeOnPlayToggle.checked;
  await chrome.storage.local.set({ [REMOVE_ON_PLAY_KEY]: removeOnPlay });
}

async function syncWithPhone() {
  syncPhone.disabled = true;
  syncStatus.textContent = t("syncInProgress");

  try {
    const result = await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      action: "sync",
      videos
    });
    if (!result?.ok) throw new Error(result?.error || "syncFailed");

    const deletedIds = new Set(Array.isArray(result.deletedVideoIds) ? result.deletedVideoIds : []);
    if (deletedIds.size) {
      videos = videos.filter((video) => !deletedIds.has(video.id));
      await chrome.storage.local.set({ [STORAGE_KEY]: videos });
    }

    const deletedCount = deletedIds.size;
    syncStatus.textContent = t("syncSuccess", [String(videos.length), String(deletedCount)]);
    render();
  } catch (error) {
    const message = String(error?.message || error || "");
    syncStatus.textContent = t(nativeErrorMessageKey(message));
  } finally {
    syncPhone.disabled = false;
  }
}

function nativeErrorMessageKey(message) {
  if (message.includes("unauthorized")) return "syncUnauthorized";
  if (message.includes("not found") || message.includes("Native host")) return "syncCompanionMissing";
  if (message.includes("application is not installed")) return "syncAppMissing";
  if (message.includes("multiple")) return "syncMultipleDevices";
  if (message.includes("device")) return "syncNoDevice";
  return "syncFailed";
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatTotalDuration(totalSeconds) {
  const totalMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) parts.push(t("durationHours", [String(hours)]));
  if (minutes || !hours) parts.push(t("durationMinutes", [String(minutes)]));
  return parts.join(" ");
}

async function clearVideos() {
  if (!confirm(t("clearConfirm", [String(videos.length)]))) return;
  videos = [];
  await chrome.storage.local.set({ [STORAGE_KEY]: videos });
}

function exportVideos() {
  if (!videos.length) {
    alert(t("exportEmpty"));
    return;
  }

  const backup = {
    format: "LaterTube backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    videos
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `LaterTube-backup-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importVideos() {
  const [file] = importFile.files;
  importFile.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const incoming = parseImportFile(text);
    if (!incoming.length) {
      alert(t("importNoVideos"));
      return;
    }

    const knownIds = new Set(videos.map((video) => video.id));
    const added = [];
    let duplicateCount = 0;
    for (const candidate of incoming) {
      if (knownIds.has(candidate.id)) {
        duplicateCount++;
        continue;
      }
      knownIds.add(candidate.id);
      added.push(candidate);
    }

    if (added.length) {
      videos = [...videos, ...added];
      await chrome.storage.local.set({ [STORAGE_KEY]: videos });
    }
    alert(t("importSuccess", [String(added.length), String(duplicateCount)]));
  } catch {
    alert(t("importFailed"));
  }
}

function parseImportFile(text) {
  try {
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : parsed?.videos;
    if (Array.isArray(entries)) return entries.map(normalizeImportedVideo).filter(Boolean);
  } catch {
    // A plain text file with YouTube links is also supported.
  }

  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return urls.map((url, index) => {
    const id = extractVideoId(url.replace(/[),.;]+$/, ""));
    return id ? normalizeImportedVideo({ id, addedAt: Date.now() + index }) : null;
  }).filter(Boolean);
}

function normalizeImportedVideo(video) {
  if (!video || typeof video !== "object") return null;
  const id = validVideoId(video.id) || extractVideoId(video.url);
  if (!id) return null;
  const duration = Number(video.durationSeconds);
  const addedAt = Number(video.addedAt);
  const publishedAt = Number(video.publishedAt);
  const viewCount = hasViewCount(video.viewCount) ? Number(video.viewCount) : null;
  return {
    id,
    title: typeof video.title === "string" && video.title.trim() ? video.title.trim() : t("videoFallback"),
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: typeof video.thumbnail === "string" && video.thumbnail
      ? video.thumbnail
      : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    channel: typeof video.channel === "string" ? video.channel : "",
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    publishedAt: Number.isFinite(publishedAt) && publishedAt > 0 ? Math.round(publishedAt) : null,
    viewCount: viewCount !== null ? Math.round(viewCount) : null,
    addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : Date.now()
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

function validVideoId(value) {
  return /^[a-zA-Z0-9_-]{6,20}$/.test(value || "") ? value : null;
}

function formatDate(timestamp) {
  if (!timestamp) return t("recently");
  return new Intl.DateTimeFormat(uiLanguage, { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}
