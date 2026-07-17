const OWN_MARKER = "data-my-watch-later";
const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
let lastCardVideo = null;
let lastUrl = location.href;

document.addEventListener("pointerdown", rememberClickedVideo, true);
document.addEventListener("yt-navigate-finish", refreshPageControls);

const observer = new MutationObserver(() => scheduleRefresh());
observer.observe(document.documentElement, { childList: true, subtree: true });

let refreshTimer = 0;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshPageControls, 120);
}

function refreshPageControls() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastCardVideo = null;
  }
  injectHeaderButton();
  injectWatchButton();
  injectMenuItem();
}

function injectHeaderButton() {
  if (document.querySelector(`[${OWN_MARKER}="header"]`)) return;

  const buttons = document.querySelector("ytd-masthead #buttons");
  if (!buttons) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mwl-header-button";
  button.setAttribute(OWN_MARKER, "header");
  button.title = t("openList");
  button.innerHTML = `${bookmarkIcon()}<span>${t("myVideos")}</span>`;
  button.addEventListener("click", () => sendRuntimeMessage({ type: "OPEN_LIST" }));
  buttons.prepend(button);
}

function injectWatchButton() {
  const video = currentVideo();
  if (!video) return;

  const container = document.querySelector("ytd-watch-metadata #top-level-buttons-computed");
  if (!container) return;

  let button = container.querySelector(`[${OWN_MARKER}="watch"]`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "mwl-watch-button";
    button.setAttribute(OWN_MARKER, "watch");
    button.addEventListener("click", () => saveVideo(currentVideo(), button));
    container.prepend(button);
  }

  if (button.dataset.videoId !== video.id) {
    button.dataset.videoId = video.id;
    updateButtonState(button, video.id);
  }
}

function rememberClickedVideo(event) {
  const card = event.target.closest([
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "yt-lockup-view-model"
  ].join(","));

  if (card) {
    lastCardVideo = videoFromCard(card);
    document.querySelectorAll(`[${OWN_MARKER}="menu"]`).forEach((item) => item.remove());
  }
}

function injectMenuItem() {
  const modernSheet = [...document.querySelectorAll("yt-sheet-view-model")]
    .find((element) => element.offsetParent !== null);
  const modernHeader = modernSheet?.querySelector(".ytContextualSheetLayoutHeaderContainer");
  const modernContent = modernSheet?.querySelector(".ytContextualSheetLayoutContentContainer");
  const legacyPopup = [...document.querySelectorAll("ytd-menu-popup tp-yt-paper-listbox, ytd-menu-popup #items")]
    .find((element) => element.offsetParent !== null);
  const popup = modernHeader || modernContent || legacyPopup;
  if (!popup) return;
  const video = lastCardVideo;
  if (!video) return;

  let item = popup.querySelector(`[${OWN_MARKER}="menu"]`);
  if (item) return;

  item = document.createElement("div");
  item.className = `mwl-menu-item${modernSheet ? " mwl-modern-menu-item" : ""}`;
  item.setAttribute(OWN_MARKER, "menu");
  item.setAttribute("role", "menuitem");
  item.tabIndex = 0;
  item.innerHTML = `${bookmarkIcon()}<span>${t("watchLaterMyList")}</span>`;
  item.addEventListener("click", async () => {
    const selectedVideo = lastCardVideo;
    if (!selectedVideo) return;
    await saveVideo(selectedVideo, item);
    setTimeout(() => document.body.click(), 350);
  });
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") item.click();
  });
  if (modernSheet) {
    popup.prepend(item);
  } else {
    popup.append(item);
  }

  item.dataset.videoId = video.id;
  sendRuntimeMessage({ type: "HAS_VIDEO", videoId: video.id }).then((result) => {
    if (!result) return;
    if (!item.isConnected || item.dataset.videoId !== video.id) return;
    item.classList.toggle("is-saved", result.saved);
    item.querySelector("span").textContent = result.saved
      ? t("alreadyInMyList")
      : t("watchLaterMyList");
  });
}

function currentVideo() {
  try {
    const url = new URL(location.href);
    const id = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1];
    if (!id) return null;

    const title = document.querySelector("ytd-watch-metadata h1 yt-formatted-string, h1.title yt-formatted-string")?.textContent?.trim()
      || document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim()
      || t("videoFallback");
    const channel = document.querySelector("ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a")?.textContent?.trim() || "";
    const playerDuration = document.querySelector("video")?.duration;
    const durationSeconds = Number.isFinite(playerDuration) && playerDuration > 0
      ? Math.round(playerDuration)
      : parseDuration(document.querySelector(".ytp-time-duration")?.textContent);
    const publishedAt = parsePublishedDate(
      document.querySelector('meta[itemprop="datePublished"], meta[itemprop="uploadDate"]')?.content
    );
    const viewCount = parseViewCount(
      document.querySelector('meta[itemprop="interactionCount"]')?.content
      || document.querySelector("ytd-watch-info-text #info span, #info-text #info span")?.textContent
    );
    return makeVideo(id, title, channel, durationSeconds, publishedAt, viewCount);
  } catch {
    return null;
  }
}

function videoFromCard(card) {
  const link = card.querySelector("a#thumbnail[href], a.ytd-thumbnail[href], a[href*='/watch?v='], a[href*='/shorts/'], a[href*='/live/']");
  if (!link) return null;
  try {
    const url = new URL(link.href, location.origin);
    const id = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1];
    if (!id) return null;
    const titleElement = card.querySelector("#video-title, #video-title-link, h3 a, a[title], .yt-lockup-metadata-view-model__title span");
    const title = titleElement?.getAttribute("title") || titleElement?.textContent?.trim() || t("videoFallback");
    const channel = card.querySelector("ytd-channel-name a, #channel-name a, .ytd-channel-name")?.textContent?.trim() || "";
    const durationText = [...card.querySelectorAll("ytd-thumbnail-overlay-time-status-renderer #text, .badge-shape-wiz__text, .yt-badge-shape__text")]
      .map((element) => element.textContent?.trim())
      .find((text) => /^\d{1,3}:\d{2}(?::\d{2})?$/.test(text || ""));
    const metadataTexts = [...card.querySelectorAll("#metadata-line span, .yt-content-metadata-view-model__metadata-text")]
      .map((element) => element.textContent?.trim())
      .filter(Boolean);
    const publishedAt = metadataTexts.map(parseRelativeDate).find(Boolean) || null;
    const viewCount = metadataTexts.map(parseViewCount).find((value) => value !== null) ?? null;
    return makeVideo(id, title, channel, parseDuration(durationText), publishedAt, viewCount);
  } catch {
    return null;
  }
}

function makeVideo(id, title, channel, durationSeconds = null, publishedAt = null, viewCount = null) {
  return {
    id,
    title,
    channel,
    durationSeconds,
    publishedAt,
    viewCount,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  };
}

function parseViewCount(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).toLocaleLowerCase().replace(/\u00a0/g, " ").trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (!/(view|просмотр|visualizaci|vistas)/i.test(text)) return null;

  const compact = text.match(/(\d+(?:[.,]\d+)?)\s*(k|m|b)\b/i);
  const named = text.match(/(\d+(?:[.,]\d+)?)\s*(тыс|млн|млрд|mil millones|millones?|millón|mil)\b/i);
  const match = compact || named;
  if (match) {
    const amount = Number(match[1].replace(",", "."));
    const unit = match[2].toLocaleLowerCase();
    const multiplier = /^(b|млрд|mil millones)$/.test(unit)
      ? 1e9
      : /^(m|млн|millones?|millón)$/.test(unit)
        ? 1e6
        : 1e3;
    return Number.isFinite(amount) ? Math.round(amount * multiplier) : null;
  }

  const digits = text.replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

function parsePublishedDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseRelativeDate(value) {
  if (!value) return null;
  const text = value.toLocaleLowerCase().replace(/\u00a0/g, " ");
  if (!/(ago|назад|hace)/i.test(text)) return null;

  const numberMatch = text.match(/\d+/);
  const amount = numberMatch ? Number(numberMatch[0]) : 1;
  if (!Number.isFinite(amount) || amount < 0) return null;

  const units = [
    { pattern: /second|секунд|segundo/, milliseconds: 1000 },
    { pattern: /minute|минут|minuto/, milliseconds: 60 * 1000 },
    { pattern: /hour|час|hora/, milliseconds: 60 * 60 * 1000 },
    { pattern: /day|день|дня|дней|día/, milliseconds: 24 * 60 * 60 * 1000 },
    { pattern: /week|недел|semana/, milliseconds: 7 * 24 * 60 * 60 * 1000 },
    { pattern: /month|месяц|месяц[аеыв]?|mes(?:es)?/, milliseconds: 30.44 * 24 * 60 * 60 * 1000 },
    { pattern: /year|год|года|лет|año/, milliseconds: 365.25 * 24 * 60 * 60 * 1000 }
  ];
  const unit = units.find(({ pattern }) => pattern.test(text));
  return unit ? Math.round(Date.now() - amount * unit.milliseconds) : null;
}

function parseDuration(text) {
  if (!text) return null;
  const parts = text.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0) || null;
}

async function saveVideo(video, button) {
  if (!video) return;
  const result = await sendRuntimeMessage({ type: "ADD_VIDEO", video });
  if (!result) return;
  button.classList.toggle("is-saved", result.added || result.duplicate);
  setButtonContents(button, result.added ? t("added") : t("alreadyInList"), true);
  setTimeout(() => {
    if (button.isConnected && button.matches(".mwl-watch-button")) updateButtonState(button, video.id);
  }, 1600);
}

async function updateButtonState(button, videoId) {
  const result = await sendRuntimeMessage({ type: "HAS_VIDEO", videoId });
  if (!result) return;
  if (!button.isConnected || button.dataset.videoId !== videoId) return;
  button.classList.toggle("is-saved", result.saved);
  setButtonContents(button, result.saved ? t("inMyList") : t("watchLater"), result.saved);
}

function setButtonContents(button, label, checked) {
  button.innerHTML = `${checked ? checkIcon() : bookmarkIcon()}<span>${label}</span>`;
}

async function sendRuntimeMessage(message) {
  if (!chrome.runtime?.id) {
    observer.disconnect();
    return null;
  }

  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    // После обновления расширения старый content script остаётся во вкладке,
    // но его extension context уже недействителен. Останавливаем его до reload страницы.
    if (!chrome.runtime?.id) observer.disconnect();
    return null;
  }
}

function bookmarkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.75A1.75 1.75 0 0 1 7.75 2h8.5A1.75 1.75 0 0 1 18 3.75V22l-6-3.6L6 22V3.75Zm2 .25v14.47l4-2.4 4 2.4V4H8Z"/></svg>`;
}

function checkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.55 17.6-5.3-5.3 1.4-1.4 3.9 3.9 8.8-8.8 1.4 1.4-10.2 10.2Z"/></svg>`;
}

refreshPageControls();
