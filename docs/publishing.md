# Публикация privacy policy через GitHub Pages

Страница находится в `docs/index.md` и предназначена для публикации из ветки `main`, папки `/docs`.

1. Открыть `https://github.com/glebster51/LaterTube/settings/pages`.
2. В разделе **Build and deployment** выбрать **Deploy from a branch**.
3. Выбрать ветку `main` и папку `/docs`, затем нажать **Save**.
4. Дождаться публикации `https://glebster51.github.io/LaterTube/`.
5. Указать этот адрес в Privacy policy URL в Chrome Web Store Developer Dashboard.

Если поведение расширения при работе с данными меняется, сначала обновить policy и disclosures в Chrome Web Store.

## Бесплатная инфраструктура Firebase

- Firebase project: `My First Project`, ID `project-70c3b6d7-5d2b-4f83-9bb`.
- План: **Spark**, без Cloud Billing и без карты.
- Authentication provider: **Email/Password**.
- Хранилище: **Realtime Database**.
- Правила: `database.rules.json`; доступ разрешён только авторизованному владельцу соответствующего `uid`.
- Публичный репозиторий содержит только `firebase-config.example.js` и `android/firebase.properties.example`.
- Рабочие `firebase-config.local.js` и `android/firebase.properties` игнорируются Git.
- Перед следующим обновлением Chrome Web Store раскрыть локальный UI-кэш списка: Firebase остаётся источником истины, а снимок используется для мгновенного рендера и экономии трафика.

Для текущего личного сценария платные Firebase-функции, Google Drive API, OAuth client, собственный сервер и Native Messaging host не нужны.
