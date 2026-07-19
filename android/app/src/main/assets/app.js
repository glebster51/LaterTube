const list = document.querySelector('#list');
const empty = document.querySelector('#empty');
const summary = document.querySelector('#summary');

function render() {
  const videos = JSON.parse(Android.getVideos());
  summary.textContent = `${videos.length} видео на телефоне`;
  empty.hidden = videos.length !== 0;
  list.replaceChildren(...videos.map(video => {
    const card = document.createElement('article');
    card.className = 'card';
    const image = document.createElement('img'); image.className = 'thumbnail'; image.src = video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
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
function duration(seconds) { const s = Math.round(Number(seconds) || 0); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`; }
render();
