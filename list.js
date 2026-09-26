const REMOVE_ON_PLAY_KEY = "removeOnPlay";
const SORT_KEY = "sortMode";
const THUMBNAIL_CACHE = "latertube-thumbnails-v1";
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
const connectCloud = document.querySelector("#connect-cloud");
const cloudStatus = document.querySelector("#cloud-status");
const metadataStatus = document.querySelector("#metadata-status");
const activeTab = document.querySelector("#active-tab");
const historyTab = document.querySelector("#history-tab");
const template = document.querySelector("#card-template");
const supportDialog = document.querySelector("#support-dialog");
const copyStatus = document.querySelector("#copy-status");
const authDialog = document.querySelector("#auth-dialog");
const authEmail = document.querySelector("#auth-email");
const authPassword = document.querySelector("#auth-password");
const authError = document.querySelector("#auth-error");
const authSignIn = document.querySelector("#auth-sign-in");
const authSignUp = document.querySelector("#auth-sign-up");
const authReset = document.querySelector("#auth-reset");

let activeVideos = [];
let historyVideos = [];
let selectedTab = "active";
let removeOnPlay = false;
let connected = false;
let renderedStateSignature = "";
let refreshPromise = null;
let lastAutoRefreshAt = 0;
const AUTO_REFRESH_DEBOUNCE_MS = 750;
const randomRanks = new Map();

localizePage();
void loadState();
search.addEventListener("input", render);
sort.addEventListener("change", saveSort);
clearAll.addEventListener("click", clearVideos);
exportList.addEventListener("click", exportVideos);
importList.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", importVideos);
removeOnPlayToggle.addEventListener("change", saveRemoveOnPlay);
connectCloud.addEventListener("click", connectFirebase);
authSignIn.addEventListener("click", () => authenticate(false));
authSignUp.addEventListener("click", () => authenticate(true));
authReset.addEventListener("click", requestPasswordReset);
document.querySelector("#close-auth").addEventListener("click", () => authDialog.close());
window.addEventListener("focus", requestAutoRefresh);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestAutoRefresh();
});
activeTab.addEventListener("click", () => selectTab("active"));
historyTab.addEventListener("click", () => selectTab("history"));
document.querySelector("#open-support").addEventListener("click", () => supportDialog.showModal());
document.querySelector("#close-support").addEventListener("click", () => supportDialog.close());
supportDialog.addEventListener("click", event => {
  if (event.target === supportDialog) supportDialog.close();
});
document.querySelectorAll(".copy-address").forEach(button => {
  button.addEventListener("click", () => copyWalletAddress(button));
});

async function copyWalletAddress(button) {
  try {
    await navigator.clipboard.writeText(button.dataset.address);
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
  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(element => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(element => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach(element => {
    element.alt = t(element.dataset.i18nAlt);
  });
  clearAll.dataset.shortLabel = t("clearShort");
}

async function loadState() {
  const stored = await chrome.storage.local.get([REMOVE_ON_PLAY_KEY, SORT_KEY]);
  removeOnPlay = stored[REMOVE_ON_PLAY_KEY] === true;
  removeOnPlayToggle.checked = removeOnPlay;
  if (typeof stored[SORT_KEY] === "string") sort.value = stored[SORT_KEY];
  refreshRandomRanks(true);
  try {
    const cached = await sendMessage("GET_CACHED_STATE");
    if (cached?.active && cached?.history) {
      applyState(cached);
      connected = true;
      cloudStatus.textContent = t("cloudReady");
      connectCloud.hidden = true;
    } else render();
    const auth = await sendMessage("GET_AUTH_STATUS");
    if (auth.signedIn) await refreshCloud(!cached?.active);
    else showCloudError({ code: "AUTH_REQUIRED" });
  } catch (error) {
    showCloudError(error);
  }
}

function connectFirebase() {
  if (connected) return;
  authError.textContent = "";
  authDialog.showModal();
  authEmail.focus();
}

async function authenticate(createAccount) {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.classList.remove("success");
  if (!email || password.length < 6) {
    authError.textContent = t("authFieldsRequired");
    return;
  }
  authSignIn.disabled = true;
  authSignUp.disabled = true;
  authReset.disabled = true;
  authError.textContent = t(createAccount ? "authCreating" : "authSigningIn");
  try {
    const state = await sendMessage(createAccount ? "FIREBASE_SIGN_UP" : "FIREBASE_SIGN_IN", { email, password });
    authPassword.value = "";
    authDialog.close();
    connected = true;
    applyState(state);
    cloudStatus.textContent = t("cloudReady");
    connectCloud.hidden = true;
    void enrichIncompleteMetadata();
  } catch (error) {
    authError.textContent = t(authErrorKey(error?.code));
  } finally {
    authSignIn.disabled = false;
    authSignUp.disabled = false;
    authReset.disabled = false;
  }
}

async function requestPasswordReset() {
  const email = authEmail.value.trim();
  authError.classList.remove("success");
  if (!email || !authEmail.checkValidity()) {
    authError.textContent = t("resetEmailRequired");
    return;
  }
  authSignIn.disabled = true;
  authSignUp.disabled = true;
  authReset.disabled = true;
  authError.textContent = t("resetSending");
  try {
    await sendMessage("FIREBASE_PASSWORD_RESET", { email });
    authError.classList.add("success");
    authError.textContent = t("resetEmailSent");
  } catch (error) {
    authError.textContent = t(error?.code === "INVALID_EMAIL" ? "resetEmailRequired" : authErrorKey(error?.code));
  } finally {
    authSignIn.disabled = false;
    authSignUp.disabled = false;
    authReset.disabled = false;
  }
}

function authErrorKey(code) {
  if (code === "EMAIL_EXISTS") return "authEmailExists";
  if (code === "INVALID_CREDENTIALS") return "authInvalidCredentials";
  if (code === "WEAK_PASSWORD") return "authWeakPassword";
  if (code === "TOO_MANY_ATTEMPTS") return "authTooManyAttempts";
  if (code === "EMAIL_AUTH_DISABLED") return "authDisabled";
  if (code === "FIREBASE_NOT_CONFIGURED") return "cloudNotConfigured";
  return "authFailed";
}

function requestAutoRefresh() {
  if (!connected || document.hidden) return;
  const now = Date.now();
  if (now - lastAutoRefreshAt < AUTO_REFRESH_DEBOUNCE_MS) return;
  lastAutoRefreshAt = now;
  void refreshCloud(false);
}

function refreshCloud(showProgress) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performRefresh(showProgress).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function performRefresh(showProgress) {
  if (showProgress) cloudStatus.textContent = t("cloudLoading");
  try {
    const state = await sendMessage("GET_CLOUD_STATE", { force: true });
    const changed = applyState(state);
    connected = true;
    cloudStatus.textContent = t("cloudReady");
    connectCloud.hidden = true;
    if (changed && !state.notModified) void enrichIncompleteMetadata();
  } catch (error) {
    if (!renderedStateSignature) connected = false;
    showCloudError(error);
  }
}

function showCloudError(error) {
  const code = error?.code || "CLOUD_ERROR";
  if (code === "AUTH_REQUIRED") connected = false;
  cloudStatus.textContent = t(code === "AUTH_REQUIRED" ? "cloudAuthRequired"
    : code === "FIREBASE_NOT_CONFIGURED" ? "cloudNotConfigured"
      : code === "FIREBASE_DATABASE_MISSING" ? "cloudDatabaseMissing"
      : code === "INVALID_CLOUD_DATA" ? "cloudInvalidData"
        : "cloudFailed");
  connectCloud.hidden = connected;
  connectCloud.textContent = t("connectFirebase");
}

async function sendMessage(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (result?.error) {
    const error = new Error(result.error.message || result.error.code);
    error.code = result.error.code;
    throw error;
  }
  return result || {};
}

function applyState(state) {
  const nextActive = Array.isArray(state.active) ? state.active : [];
  const nextHistory = Array.isArray(state.history) ? state.history : [];
  const signature = stateSignature(state, nextActive, nextHistory);
  if (signature === renderedStateSignature) return false;
  renderedStateSignature = signature;
  activeVideos = nextActive;
  historyVideos = nextHistory;
  refreshRandomRanks();
  render();
  return true;
}

function stateSignature(state, active, history) {
  const revision = Number(state?.updatedAt) || 0;
  if (revision) return `${revision}:${active.length}:${history.length}`;
  return [active, history].map(videos => videos.map(video =>
    `${video.id}:${Number(video.updatedAt) || 0}:${video.changeId || ""}`
  ).join(",")).join("|");
}

function selectTab(tab) {
  selectedTab = tab;
  activeTab.classList.toggle("active", tab === "active");
  activeTab.setAttribute("aria-selected", String(tab === "active"));
  historyTab.classList.toggle("active", tab === "history");
  historyTab.setAttribute("aria-selected", String(tab === "history"));
  removeOnPlayToggle.closest(".toggle").hidden = tab === "history";
  render();
}

function render() {
  const videos = selectedTab === "active" ? activeVideos : historyVideos;
  const query = search.value.trim().toLocaleLowerCase(uiLanguage);
  const visible = videos
    .filter(video => !query || `${video.title} ${video.channel || ""}`.toLocaleLowerCase(uiLanguage).includes(query))
    .sort(sortVideos);

  grid.replaceChildren(...visible.map(createCard));
  const counterParts = [selectedTab === "active"
    ? t("videoCount", [String(videos.length)])
    : t("historyCount", [String(videos.length)])];
  const totalDuration = videos.reduce((total, video) => {
    const duration = Number(video.durationSeconds);
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  if (totalDuration > 0) counterParts.push(t("totalDuration", [formatTotalDuration(totalDuration)]));
  if (query) counterParts.push(t("foundCount", [String(visible.length)]));
  counter.textContent = counterParts.join(" · ");
  empty.hidden = videos.length !== 0;
  grid.hidden = videos.length === 0;
  clearAll.hidden = selectedTab === "history" || activeVideos.length === 0;
  const emptyHeading = empty.querySelector("h2");
  const emptyText = empty.querySelector("p");
  emptyHeading.textContent = t(selectedTab === "active" ? "emptyHeading" : "historyEmptyHeading");
  emptyText.textContent = t(selectedTab === "active" ? "emptyText" : "historyEmptyText");
}

function createCard(video) {
  const card = template.content.firstElementChild.cloneNode(true);
  const isHistory = selectedTab === "history";
  card.classList.toggle("history-card", isHistory);
  const links = card.querySelectorAll(".thumbnail-link, .video-title");
  links.forEach(link => {
    link.href = video.url;
    link.addEventListener("click", event => handleVideoOpen(event, video));
  });

  const image = card.querySelector(".thumbnail");
  image.alt = t("thumbnailAlt", [video.title]);
  void loadThumbnail(image, video);

  const duration = card.querySelector(".duration");
  if (video.durationSeconds) {
    duration.textContent = formatDuration(video.durationSeconds);
    duration.hidden = false;
  }

  const title = card.querySelector(".video-title");
  title.textContent = video.title;
  title.title = video.title;
  card.querySelector(".channel").textContent = video.channel || "YouTube";

  const viewCount = card.querySelector(".view-count");
  if (hasViewCount(video.viewCount)) viewCount.textContent = t("viewsLabel", [formatViewCount(video.viewCount)]);
  else viewCount.hidden = true;

  const publishedDate = card.querySelector(".published-date");
  if (video.publishedAt) publishedDate.textContent = t("publishedDate", [formatDate(video.publishedAt)]);
  else publishedDate.hidden = true;
  card.querySelector(".added-date").textContent = isHistory
    ? t("removedDate", [formatDate(video.removedAt)])
    : t("addedDate", [formatDate(video.addedAt)]);

  const actionButton = card.querySelector(".remove-button");
  const deleteButton = card.querySelector(".delete-forever-button");
  if (isHistory) {
    actionButton.classList.add("restore-button");
    actionButton.textContent = t("restoreVideo");
    actionButton.title = t("restoreVideo");
    actionButton.setAttribute("aria-label", t("restoreVideo"));
    actionButton.addEventListener("click", () => restoreVideo(video.id));
    deleteButton.hidden = false;
    deleteButton.textContent = t("deleteForever");
    deleteButton.title = t("deleteForever");
    deleteButton.setAttribute("aria-label", t("deleteForever"));
    deleteButton.addEventListener("click", () => deleteHistoryVideo(video.id, video.title));
  } else {
    actionButton.title = t("removeFromList");
    actionButton.setAttribute("aria-label", t("removeFromList"));
    actionButton.addEventListener("click", () => archiveVideo(video.id));
  }
  return card;
}

async function loadThumbnail(image, video) {
  const fallback = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
  const source = video.thumbnail || fallback;
  image.src = source;
  try {
    const cache = await caches.open(THUMBNAIL_CACHE);
    let response = await cache.match(source);
    if (!response) {
      const fetched = await fetch(source, { credentials: "omit" });
      if (!fetched.ok) throw new Error("thumbnail-fetch-failed");
      response = fetched.clone();
      await cache.put(source, fetched);
    }
    const url = URL.createObjectURL(await response.blob());
    const replacement = new Image();
    replacement.addEventListener("load", () => {
      image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      image.src = url;
    }, { once: true });
    replacement.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
    replacement.src = url;
  } catch {
    if (image.src !== fallback) image.src = fallback;
  }
}

async function handleVideoOpen(event, video) {
  if (selectedTab === "history" || !removeOnPlay) return;
  event.preventDefault();
  try {
    await archiveVideo(video.id, false);
    await chrome.tabs.create({ url: video.url });
  } catch {
    // The list stays unchanged and the video is not opened when Firebase did not confirm the move.
  }
}

async function archiveVideo(id, announce = true) {
  try {
    if (announce) cloudStatus.textContent = t("cloudSaving");
    const state = await sendMessage("ARCHIVE_VIDEO", { videoId: id });
    applyState(state);
    cloudStatus.textContent = t("cloudSaved");
  } catch (error) {
    showCloudError(error);
    throw error;
  }
}

async function restoreVideo(id) {
  try {
    cloudStatus.textContent = t("cloudSaving");
    const state = await sendMessage("RESTORE_VIDEO", { videoId: id });
    applyState(state);
    cloudStatus.textContent = t("cloudSaved");
  } catch (error) {
    showCloudError(error);
  }
}

async function deleteHistoryVideo(id, title) {
  if (!confirm(t("deleteForeverConfirm", [title || t("videoFallback")]))) return;
  try {
    cloudStatus.textContent = t("cloudDeleting");
    const state = await sendMessage("DELETE_HISTORY_VIDEO", { videoId: id });
    applyState(state);
    cloudStatus.textContent = t("cloudDeleted");
  } catch (error) {
    showCloudError(error);
  }
}

async function clearVideos() {
  if (!activeVideos.length || !confirm(t("clearConfirm", [String(activeVideos.length)]))) return;
  try {
    cloudStatus.textContent = t("cloudSaving");
    applyState(await sendMessage("CLEAR_ACTIVE"));
    cloudStatus.textContent = t("cloudSaved");
  } catch (error) {
    showCloudError(error);
  }
}

async function saveRemoveOnPlay() {
  removeOnPlay = removeOnPlayToggle.checked;
  await chrome.storage.local.set({ [REMOVE_ON_PLAY_KEY]: removeOnPlay });
}

async function saveSort() {
  await chrome.storage.local.set({ [SORT_KEY]: sort.value });
  if (sort.value === "random") refreshRandomRanks(true);
  render();
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
  if (!hasViewCount(a) && !hasViewCount(b)) return 0;
  if (!hasViewCount(a)) return 1;
  if (!hasViewCount(b)) return -1;
  return (Number(a) - Number(b)) * direction;
}

function hasViewCount(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function refreshRandomRanks(reset = false) {
  if (reset) randomRanks.clear();
  const ids = new Set([...activeVideos, ...historyVideos].map(video => video.id));
  for (const id of randomRanks.keys()) if (!ids.has(id)) randomRanks.delete(id);
  for (const id of ids) if (!randomRanks.has(id)) randomRanks.set(id, Math.random());
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
  return compareTimestamp(a.durationSeconds, b.durationSeconds, direction);
}

function formatViewCount(value) {
  return new Intl.NumberFormat(uiLanguage, { notation: "compact", maximumFractionDigits: 1 }).format(value);
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

function formatDate(value) {
  const number = Number(value);
  const date = Number.isFinite(number) ? new Date(number) : new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(uiLanguage, { day: "numeric", month: "short", year: "numeric" }).format(date)
    : t("recently");
}

function exportVideos() {
  if (!activeVideos.length) {
    alert(t("exportEmpty"));
    return;
  }
  const backup = {
    format: "LaterTube backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    videos: activeVideos
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
    const incoming = parseImportFile(await file.text());
    if (!incoming.length) {
      alert(t("importNoVideos"));
      return;
    }
    cloudStatus.textContent = t("cloudSaving");
    const result = await sendMessage("IMPORT_VIDEOS", { videos: incoming });
    const results = Array.isArray(result.results) ? result.results : [];
    await refreshCloud(false);
    const added = results.filter(item => item.added || item.restored).length;
    alert(t("importSuccess", [String(added), String(results.length - added)]));
  } catch (error) {
    if (error?.code) showCloudError(error);
    alert(t("importFailed"));
  }
}

function parseImportFile(text) {
  try {
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : parsed?.videos;
    if (Array.isArray(entries)) return entries.map(normalizeImportedVideo).filter(Boolean);
  } catch { }
  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return urls.map((url, index) => normalizeImportedVideo({ url: url.replace(/[),.;]+$/, ""), addedAt: Date.now() + index })).filter(Boolean);
}

function normalizeImportedVideo(video) {
  if (!video || typeof video !== "object") return null;
  const id = validVideoId(video.id) || extractVideoId(video.url);
  if (!id) return null;
  return {
    ...video,
    id,
    title: typeof video.title === "string" && video.title.trim() ? video.title.trim() : t("videoFallback"),
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: typeof video.thumbnail === "string" && video.thumbnail
      ? video.thumbnail
      : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
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
  } catch { return null; }
}

function validVideoId(value) {
  return /^[a-zA-Z0-9_-]{6,20}$/.test(value || "") ? value : null;
}

async function enrichIncompleteMetadata() {
  const incompleteCount = activeVideos.filter(needsMetadata).length;
  if (!incompleteCount) return;
  metadataStatus.textContent = t("metadataLoading", [String(incompleteCount)]);
  try {
    const result = await sendMessage("ENRICH_INCOMPLETE_VIDEOS");
    metadataStatus.textContent = result.updated
      ? t("metadataUpdated", [String(result.updated), String(result.checked)])
      : t("metadataNotFound", [String(result.checked || incompleteCount)]);
    if (result.updated) await refreshCloud(false);
  } catch {
    metadataStatus.textContent = t("metadataFailed");
  }
}

function needsMetadata(video) {
  const missingText = value => typeof value !== "string" || !value.trim();
  return missingText(video.title) || missingText(video.channel)
    || !(Number(video.durationSeconds) > 0) || !(Number(video.publishedAt) > 0)
    || !hasViewCount(video.viewCount) || missingText(video.thumbnail);
}
