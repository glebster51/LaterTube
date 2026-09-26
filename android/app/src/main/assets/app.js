const list = document.querySelector('#list');
const empty = document.querySelector('#empty');
const emptyHeading = document.querySelector('#empty-heading');
const emptyText = document.querySelector('#empty-text');
const summary = document.querySelector('#summary');
const cloudStatus = document.querySelector('#cloud-status');
const accountButton = document.querySelector('#account-button');
const authPanel = document.querySelector('#auth-panel');
const authFields = document.querySelector('#auth-fields');
const authEmail = document.querySelector('#auth-email');
const authPassword = document.querySelector('#auth-password');
const signInButton = document.querySelector('#sign-in');
const signUpButton = document.querySelector('#sign-up');
const resetPasswordButton = document.querySelector('#reset-password');
const refreshButton = document.querySelector('#refresh-cloud');
const signOutButton = document.querySelector('#sign-out');
const authError = document.querySelector('#auth-error');
const sort = document.querySelector('#sort');
const removeOnOpen = document.querySelector('#remove-on-open');
const removeToggle = document.querySelector('#remove-toggle');
const activeTab = document.querySelector('#active-tab');
const historyTab = document.querySelector('#history-tab');
const activeCount = document.querySelector('#active-count');
const historyCount = document.querySelector('#history-count');
const pullRefresh = document.querySelector('#pull-refresh');

let activeVideos = [];
let historyVideos = [];
let selectedTab = 'active';
let connected = false;
let busy = false;
let refreshing = false;
let accountEmail = '';
let renderedStateSignature = '';
let pullStartY = 0;
let pullDistance = 0;
let pullTracking = false;
const randomRanks = new Map();
const PULL_THRESHOLD = 72;

sort.value = Android.getSort();
removeOnOpen.checked = Android.getRemoveOnOpen();
sort.addEventListener('change', () => {
  Android.setSort(sort.value);
  if (sort.value === 'random') resetRandomRanks();
  render();
});
sort.addEventListener('click', () => {
  if (sort.value !== 'random') return;
  resetRandomRanks();
  render();
});
removeOnOpen.addEventListener('change', () => Android.setRemoveOnOpen(removeOnOpen.checked));
activeTab.addEventListener('click', () => setSelectedTab('active'));
historyTab.addEventListener('click', () => setSelectedTab('history'));
accountButton.addEventListener('click', () => {
  authPanel.hidden = !authPanel.hidden;
  updateAccountPanel();
});
signInButton.addEventListener('click', () => authenticate(false));
signUpButton.addEventListener('click', () => authenticate(true));
resetPasswordButton.addEventListener('click', requestPasswordReset);
refreshButton.addEventListener('click', () => requestCloudRefresh(false));
signOutButton.addEventListener('click', () => {
  Android.signOut();
  connected = false;
  accountEmail = '';
  activeVideos = [];
  historyVideos = [];
  renderedStateSignature = '';
  updateAccountPanel();
  render();
});
authPassword.addEventListener('keydown', event => {
  if (event.key === 'Enter') authenticate(false);
});
document.addEventListener('touchstart', beginPull, { passive: true });
document.addEventListener('touchmove', updatePull, { passive: false });
document.addEventListener('touchend', finishPull, { passive: true });
document.addEventListener('touchcancel', cancelPull, { passive: true });

window.LaterTube = {
  receiveState(json, fromCache = false) {
    try {
      const state = JSON.parse(json);
      applyState(state);
      connected = true;
      accountEmail = state.email || '';
      authPassword.value = '';
      authError.textContent = '';
      authPanel.hidden = true;
      cloudStatus.textContent = fromCache ? 'Показываю сохранённый список…' : 'Список синхронизирован';
      setBusy(false);
      setRefreshing(false);
      updateAccountPanel();
    } catch {
      this.receiveError('INVALID_CLOUD_DATA', 'Некорректные данные');
    }
  },
  receiveCloudNotModified() {
    cloudStatus.textContent = 'Список уже актуален';
    setRefreshing(false);
  },
  receiveError(code) {
    authError.classList.remove('success');
    const authCodes = new Set([
      'AUTH_FAILED', 'EMAIL_EXISTS', 'INVALID_CREDENTIALS',
      'INVALID_EMAIL', 'WEAK_PASSWORD', 'TOO_MANY_ATTEMPTS', 'EMAIL_AUTH_DISABLED'
    ]);
    if (code === 'AUTH_REQUIRED') {
      connected = false;
      accountEmail = '';
      activeVideos = [];
      historyVideos = [];
      renderedStateSignature = '';
    }
    const message = errorMessage(code);
    if (authCodes.has(code)) {
      authPanel.hidden = false;
      authError.textContent = message;
    }
    cloudStatus.textContent = code === 'AUTH_REQUIRED'
      ? 'Войдите, чтобы открыть личный список.'
      : message;
    setBusy(false);
    setRefreshing(false);
    updateAccountPanel();
    render();
  },
  receivePasswordResetSent() {
    authError.classList.add('success');
    authError.textContent = 'Если аккаунт с таким email существует, письмо для сброса пароля отправлено.';
    cloudStatus.textContent = 'Письмо для сброса пароля запрошено';
    setBusy(false);
  },
  receiveDeleteStarted() {
    setBusy(true, 'Удаляю видео безвозвратно…');
  }
};

function authenticate(createAccount) {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.classList.remove('success');
  authError.textContent = '';
  if (!email || !password) {
    authError.textContent = 'Введите email и пароль.';
    return;
  }
  if (password.length < 6) {
    authError.textContent = 'Пароль должен содержать не меньше 6 символов.';
    return;
  }
  setBusy(true, createAccount ? 'Создаю аккаунт…' : 'Выполняю вход…');
  Android.authenticate(email, password, createAccount);
}

function requestPasswordReset() {
  const email = authEmail.value.trim();
  authError.classList.remove('success');
  authError.textContent = '';
  if (!email || !authEmail.checkValidity()) {
    authError.textContent = 'Сначала введите корректный email.';
    return;
  }
  setBusy(true, 'Отправляю письмо для сброса…');
  Android.requestPasswordReset(email);
}

function requestCloudRefresh(fromPull) {
  if (!connected || busy || refreshing) return;
  setRefreshing(true, fromPull);
  cloudStatus.textContent = 'Проверяю обновления…';
  Android.refresh();
}

function beginPull(event) {
  if (!connected || busy || refreshing || window.scrollY > 0 || event.touches.length !== 1) return;
  pullStartY = event.touches[0].clientY;
  pullDistance = 0;
  pullTracking = true;
}

function updatePull(event) {
  if (!pullTracking || event.touches.length !== 1) return;
  if (window.scrollY > 0) {
    cancelPull();
    return;
  }
  const rawDistance = event.touches[0].clientY - pullStartY;
  if (rawDistance <= 0) {
    cancelPull();
    return;
  }
  event.preventDefault();
  pullDistance = Math.min(108, rawDistance * .58);
  pullRefresh.style.setProperty('--pull-distance', `${pullDistance}px`);
  pullRefresh.classList.add('visible');
  pullRefresh.classList.toggle('armed', pullDistance >= PULL_THRESHOLD);
}

function finishPull() {
  if (!pullTracking) return;
  const shouldRefresh = pullDistance >= PULL_THRESHOLD;
  pullTracking = false;
  if (shouldRefresh) requestCloudRefresh(true);
  else resetPullIndicator();
}

function cancelPull() {
  pullTracking = false;
  resetPullIndicator();
}

function resetPullIndicator() {
  pullDistance = 0;
  pullRefresh.style.removeProperty('--pull-distance');
  pullRefresh.classList.remove('visible', 'armed', 'refreshing');
}

function setRefreshing(value, fromPull = false) {
  refreshing = value;
  refreshButton.disabled = value || busy;
  if (value && fromPull) pullRefresh.classList.add('visible', 'refreshing');
  else if (!value) resetPullIndicator();
}

function applyState(state) {
  const nextActive = Array.isArray(state.active) ? state.active : [];
  const nextHistory = Array.isArray(state.history) ? state.history : [];
  const revision = Number(state.updatedAt) || 0;
  const signature = revision
    ? `${revision}:${nextActive.length}:${nextHistory.length}`
    : [nextActive, nextHistory].map(videos => videos.map(video =>
      `${video.id}:${Number(video.updatedAt) || 0}:${video.changeId || ''}`
    ).join(',')).join('|');
  if (signature === renderedStateSignature) return false;
  renderedStateSignature = signature;
  activeVideos = nextActive;
  historyVideos = nextHistory;
  refreshRandomRanks([...activeVideos, ...historyVideos]);
  render();
  return true;
}

function errorMessage(code) {
  if (code === 'EMAIL_EXISTS') return 'Аккаунт с таким email уже существует. Нажмите «Войти».';
  if (code === 'INVALID_CREDENTIALS') return 'Неверный email или пароль.';
  if (code === 'INVALID_EMAIL') return 'Введите корректный email.';
  if (code === 'WEAK_PASSWORD') return 'Пароль должен содержать не меньше 6 символов.';
  if (code === 'TOO_MANY_ATTEMPTS') return 'Слишком много попыток. Попробуйте немного позже.';
  if (code === 'EMAIL_AUTH_DISABLED') return 'Вход по email ещё не включён в Firebase.';
  if (code === 'FIREBASE_NOT_CONFIGURED') return 'Firebase ещё не настроен в этой сборке LaterTube.';
  if (code === 'FIREBASE_DATABASE_MISSING') return 'База Firebase ещё не создана.';
  if (code === 'INVALID_CLOUD_DATA') return 'Облачный список повреждён.';
  if (code === 'AUTH_REQUIRED') return 'Войдите, чтобы открыть личный список.';
  return 'Не удалось связаться с облаком. Проверьте интернет.';
}

function updateAccountPanel() {
  accountButton.textContent = connected ? (accountEmail || 'Аккаунт') : 'Войти';
  authFields.hidden = connected;
  refreshButton.hidden = !connected;
  signOutButton.hidden = !connected;
  if (!connected && !authPanel.hidden) setTimeout(() => authEmail.focus(), 0);
}

function setBusy(value, message) {
  busy = value;
  accountButton.disabled = value;
  signInButton.disabled = value;
  signUpButton.disabled = value;
  resetPasswordButton.disabled = value;
  signOutButton.disabled = value;
  refreshButton.disabled = value || refreshing;
  list.classList.toggle('busy', value);
  if (message) cloudStatus.textContent = message;
}

function setSelectedTab(tab) {
  selectedTab = tab;
  activeTab.classList.toggle('active', tab === 'active');
  activeTab.setAttribute('aria-selected', String(tab === 'active'));
  historyTab.classList.toggle('active', tab === 'history');
  historyTab.setAttribute('aria-selected', String(tab === 'history'));
  removeToggle.hidden = tab === 'history';
  render();
}

function render() {
  const videos = [...(selectedTab === 'active' ? activeVideos : historyVideos)];
  sortVideos(videos);
  activeCount.textContent = `(${activeVideos.length})`;
  historyCount.textContent = `(${historyVideos.length})`;
  summary.textContent = selectedTab === 'active'
    ? `${activeVideos.length} видео в списке`
    : `${historyVideos.length} видео просмотрено`;
  empty.hidden = videos.length !== 0;
  emptyHeading.textContent = selectedTab === 'active' ? 'Список пуст' : 'Просмотренных пока нет';
  emptyText.textContent = selectedTab === 'active'
    ? 'Добавьте видео через расширение LaterTube в браузере.'
    : 'Здесь появятся просмотренные и удалённые видео.';
  list.replaceChildren(...videos.map(createCard));
}

function createCard(video) {
  const isHistory = selectedTab === 'history';
  const card = document.createElement('article');
  card.className = `card${isHistory ? ' history-card' : ''}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `Открыть видео: ${video.title || 'YouTube video'}`);
  card.addEventListener('click', () => openVideo(video));
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openVideo(video);
    }
  });

  const preview = document.createElement('div');
  preview.className = 'preview';
  const image = document.createElement('img');
  image.className = 'thumbnail';
  image.alt = '';
  const cached = Android.getThumbnailData(video.id);
  if (cached) image.src = `data:image/jpeg;base64,${cached}`;
  else {
    image.src = video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
    Android.cacheThumbnail(video.id, image.src);
  }
  image.onerror = () => image.style.visibility = 'hidden';
  const durationLabel = document.createElement('span');
  durationLabel.className = 'duration';
  durationLabel.textContent = video.durationSeconds ? duration(video.durationSeconds) : '';
  durationLabel.hidden = !video.durationSeconds;

  const content = document.createElement('div');
  content.className = 'content';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = video.title || 'YouTube video';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = isHistory ? `Просмотрено ${formatDate(video.removedAt)}` : (video.channel || 'YouTube');
  const actions = document.createElement('div');
  actions.className = 'actions';
  const actionButton = document.createElement('button');
  actionButton.type = 'button';
  actionButton.textContent = isHistory ? 'Вернуть в список' : 'В просмотренное';
  actionButton.onclick = event => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true, isHistory ? 'Возвращаю видео в список…' : 'Переношу видео в просмотренное…');
    if (isHistory) Android.restoreVideo(video.id); else Android.archiveVideo(video.id);
  };

  if (isHistory) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = 'Удалить';
    deleteButton.style.borderColor = 'rgba(242,139,130,.5)';
    deleteButton.style.color = '#f28b82';
    deleteButton.onclick = event => {
      event.stopPropagation();
      if (busy) return;
      Android.deleteHistoryVideo(video.id, video.title || 'YouTube video');
    };
    actions.append(actionButton, deleteButton);
  } else actions.append(actionButton);

  preview.append(image, durationLabel);
  content.append(title, meta, actions);
  card.append(preview, content);
  return card;
}

function openVideo(video) {
  if (busy) return;
  if (selectedTab === 'history') {
    Android.openVideo(video.id, video.url, false);
    return;
  }
  if (removeOnOpen.checked) setBusy(true, 'Переношу видео в просмотренное перед открытием…');
  Android.openVideo(video.id, video.url, removeOnOpen.checked);
}

function sortVideos(videos) {
  if (sort.value === 'random') videos.sort((a, b) => randomRanks.get(a.id) - randomRanks.get(b.id));
  else videos.sort(compareVideos);
}

function refreshRandomRanks(videos) {
  const ids = new Set(videos.map(video => video.id));
  for (const id of randomRanks.keys()) if (!ids.has(id)) randomRanks.delete(id);
  for (const video of videos) if (!randomRanks.has(video.id)) randomRanks.set(video.id, Math.random());
}

function resetRandomRanks() {
  randomRanks.clear();
  refreshRandomRanks([...activeVideos, ...historyVideos]);
}

function compareVideos(a, b) {
  const mode = sort.value;
  if (mode === 'added-oldest') return value(a.addedAt) - value(b.addedAt);
  if (mode === 'video-newest') return value(b.publishedAt) - value(a.publishedAt);
  if (mode === 'video-oldest') return value(a.publishedAt) - value(b.publishedAt);
  if (mode === 'views-most') return value(b.viewCount) - value(a.viewCount);
  if (mode === 'views-least') return value(a.viewCount) - value(b.viewCount);
  if (mode === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
  if (mode === 'shortest') return value(a.durationSeconds) - value(b.durationSeconds);
  if (mode === 'longest') return value(b.durationSeconds) - value(a.durationSeconds);
  return value(b.addedAt) - value(a.addedAt);
}

function formatDate(timestamp) {
  const date = Number(timestamp);
  return Number.isFinite(date) && date > 0
    ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
    : 'недавно';
}

function value(number) {
  const result = Number(number);
  return Number.isFinite(result) ? result : 0;
}

function duration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

if (!Android.hasCredential()) {
  authPanel.hidden = false;
  cloudStatus.textContent = 'Войдите, чтобы открыть личный список.';
}
updateAccountPanel();
render();
