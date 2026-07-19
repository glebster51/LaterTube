const list = document.querySelector('#list');
const empty = document.querySelector('#empty');
const summary = document.querySelector('#summary');
const sort = document.querySelector('#sort');

sort.value = Android.getSort();
sort.addEventListener('change', () => { Android.setSort(sort.value); render(); });

function render() {
  const videos = JSON.parse(Android.getVideos()).sort(compareVideos);
  summary.textContent = `${videos.length} видео на телефоне`;
  empty.hidden = videos.length !== 0;
  list.replaceChildren(...videos.map(video => {
    const card = document.createElement('article');
    card.className = 'card';
    const image = document.createElement('img'); image.className = 'thumbnail'; const cached = Android.getThumbnailData(video.id); if (cached) image.src = `data:image/jpeg;base64,${cached}`;
    image.onerror = () => image.style.visibility = 'hidden';
    const content = document.createElement('div');
    const title = document.createElement('a'); title.className = 'title'; title.textContent = video.title || 'YouTube video'; title.href = '#';
    title.onclick = event => { event.preventDefault(); Android.openVideo(video.url); };
    const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = `${video.channel || 'YouTube'}${video.durationSeconds ? ' · ' + duration(video.durationSeconds) : ''}`;
    const state = document.createElement('p'); state.className = 'watched'; state.textContent = video.watched ? '✓ Просмотрено' : 'Не просмотрено';
    const actions = document.createElement('div'); actions.className = 'actions';
    const watched = document.createElement('button'); watched.textContent = video.watched ? 'Не просмотрено' : 'Просмотрено'; watched.onclick = () => { Android.toggleWatched(video.id); render(); };
    const remove = document.createElement('button'); remove.textContent = 'Удалить'; remove.onclick = () => { Android.deleteVideo(video.id); render(); };
    actions.append(watched, remove); content.append(title, meta, state, actions); card.append(image, content); return card;
  }));
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
  if (mode === 'random') return randomRank(a.id) - randomRank(b.id);
  return value(b.addedAt) - value(a.addedAt);
}
function value(number) { const result = Number(number); return Number.isFinite(result) ? result : 0; }
function randomRank(id) { return String(id).split('').reduce((rank, char) => (rank * 31 + char.charCodeAt(0)) >>> 0, 0); }
function duration(seconds) { const s = Math.round(Number(seconds) || 0); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`; }
render();
