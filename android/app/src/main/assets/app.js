const list = document.querySelector('#list');
const empty = document.querySelector('#empty');
const emptyHeading = document.querySelector('#empty-heading');
const emptyText = document.querySelector('#empty-text');
const summary = document.querySelector('#summary');
const sort = document.querySelector('#sort');
const removeOnOpen = document.querySelector('#remove-on-open');
const activeTab = document.querySelector('#active-tab');
const deletionTab = document.querySelector('#deletion-tab');
const activeCount = document.querySelector('#active-count');
const deletionCount = document.querySelector('#deletion-count');

let selectedTab = 'active';
const randomRanks = new Map();

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
deletionTab.addEventListener('click', () => setSelectedTab('deletion'));

function setSelectedTab(tab) {
  selectedTab = tab;
  activeTab.classList.toggle('active', tab === 'active');
  activeTab.setAttribute('aria-selected', String(tab === 'active'));
  deletionTab.classList.toggle('active', tab === 'deletion');
  deletionTab.setAttribute('aria-selected', String(tab === 'deletion'));
  render();
}

function render() {
  const videos = JSON.parse(Android.getVideos());
  refreshRandomRanks(videos);
  const activeVideos = videos.filter(video => !video.pendingDeletion);
  const deletionVideos = videos.filter(video => video.pendingDeletion);
  const visibleVideos = selectedTab === 'active' ? activeVideos : deletionVideos;
  sortVideos(visibleVideos);

  activeCount.textContent = `(${activeVideos.length})`;
  deletionCount.textContent = `(${deletionVideos.length})`;
  summary.textContent = selectedTab === 'active' ? `${activeVideos.length} видео в списке` : `${deletionVideos.length} видео к удалению`;
  empty.hidden = visibleVideos.length !== 0;
  emptyHeading.textContent = selectedTab === 'active' ? 'Список пуст' : 'Список к удалению пуст';
  emptyText.textContent = selectedTab === 'active'
    ? 'Нажмите «Синхронизировать телефон» в расширении LaterTube на компьютере.'
    : 'Отмеченные для удаления видео появятся здесь.';

  list.replaceChildren(...visibleVideos.map(createCard));
}

function createCard(video) {
  const card = document.createElement('article');
  card.className = `card${video.pendingDeletion ? ' pending-delete' : ''}`;
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
  const actions = document.createElement('div');
  actions.className = 'actions';
  const deletionButton = document.createElement('button');
  deletionButton.type = 'button';
  deletionButton.className = video.pendingDeletion ? 'cancel-delete' : '';
  deletionButton.textContent = video.pendingDeletion ? 'Отменить удаление' : 'Удалить';
  deletionButton.onclick = event => {
    event.stopPropagation();
    Android.toggleDeletion(video.id);
    render();
  };

  preview.append(image, durationLabel);
  actions.append(deletionButton);
  content.append(title, actions);
  card.append(preview, content);
  return card;
}

function openVideo(video) {
  if (Android.openVideo(video.id, video.url)) render();
}

function sortVideos(videos) {
  if (sort.value === 'random') {
    videos.sort((a, b) => randomRanks.get(a.id) - randomRanks.get(b.id));
  } else {
    videos.sort(compareVideos);
  }
}

function refreshRandomRanks(videos) {
  const ids = new Set(videos.map(video => video.id));
  for (const id of randomRanks.keys()) if (!ids.has(id)) randomRanks.delete(id);
  for (const video of videos) if (!randomRanks.has(video.id)) randomRanks.set(video.id, Math.random());
}

function resetRandomRanks() {
  randomRanks.clear();
  refreshRandomRanks(JSON.parse(Android.getVideos()));
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

function value(number) { const result = Number(number); return Number.isFinite(result) ? result : 0; }
function duration(seconds) { const s = Math.round(Number(seconds) || 0); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`; }

render();
