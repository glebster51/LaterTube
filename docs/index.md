---
title: LaterTube Privacy Policy
---

# LaterTube Privacy Policy

**Effective date: July 31, 2026**

LaterTube is a Chrome extension and Android application for maintaining a personal list of YouTube videos. This policy explains what information LaterTube handles and why.

## Information handled

For videos selected by the user, LaterTube may store the YouTube video ID and URL, title, channel, thumbnail URL, duration, publication date, view count, date added and date moved to Watched. When the user explicitly runs the command for collecting open YouTube tabs, the extension examines open-tab URLs and titles and ignores tabs that are not YouTube video pages.

## Storage and account

The active list and Watched section (stored internally as `history`) are stored under the user's Firebase Authentication UID in a Firebase Realtime Database operated for LaterTube. Database rules allow a signed-in user to read or write only `/users/<their uid>`. The same LaterTube email/password account connects the browser extension and Android application.

The password is sent over HTTPS to Firebase Authentication and is not saved by either client. The sign-in form can ask Firebase Authentication to email a password-reset link to the entered address. A Firebase refresh token is retained so the user stays signed in; Android encrypts it with Android Keystore. Interface preferences, downloaded YouTube thumbnails and a non-authoritative snapshot of the active list and history may be cached locally. The snapshot lets the UI render immediately and compare the cloud `updatedAt` value before downloading the full JSON; Firebase remains the source of truth.

The Firebase project administrator technically has administrative access to the database. LaterTube does not inspect the personal list for advertising or profiling, sell it, or expose it to other users.

## External requests and sharing

LaterTube sends account credentials and saved-list requests to Google Firebase services. The extension also runs on YouTube pages and displays thumbnails, so the browser or Android app makes ordinary HTTPS requests to YouTube and YouTube image servers. LaterTube does not add tracking identifiers and does not send the saved list to YouTube, advertisers, data brokers or unrelated third parties.

## Import and export

A backup selected for import is parsed locally, then its video records are written to the signed-in user's Firebase list. Exported backups are generated locally and downloaded by the browser. LaterTube does not send backup files to a separate developer server.

## Optional support

LaterTube contains an optional “Say thanks” section with static USDT wallet addresses and QR codes. Support is voluntary, unlocks no features and is not tracked. LaterTube does not connect to wallets or collect transaction information.

## Retention and deletion

Removing a video moves it from the active JSON document to the unique Watched document. Restoring it moves it back with a new added date. Clearing the active list moves all its entries to Watched. A user can permanently delete an individual Watched entry after confirmation. Other Firebase cloud data remains until it is deleted from the Firebase project; local preferences, the sign-in token, the UI snapshot and thumbnail cache remain until application data is cleared, the user signs out where applicable, or the client is uninstalled.

## Permissions

- `storage` stores interface preferences, the Firebase sign-in token and a cached UI snapshot of the active list and history.
- `contextMenus` provides the command for collecting open YouTube video tabs.
- Access to `youtube.com`, `youtu.be` and `ytimg.com` supports LaterTube controls, selected-video metadata and thumbnails.
- Access to `identitytoolkit.googleapis.com` and `securetoken.googleapis.com` provides Firebase email/password authentication and token renewal.
- Access to `firebaseio.com` and `firebasedatabase.app` synchronizes the signed-in user's active list and history.

## Limited Use

LaterTube uses information received from Chrome and Google services only to provide its personal watch-list function. It is not used for advertising, creditworthiness, lending or unrelated purposes.

## Changes and contact

If LaterTube's data practices change, this policy and the Chrome Web Store disclosures will be updated before those changes are introduced. For privacy questions, open an issue in the [LaterTube GitHub repository](https://github.com/glebster51/LaterTube/issues) or use the support contact shown on the Chrome Web Store listing.

---

# Политика конфиденциальности LaterTube

**Дата вступления в силу: 31 июля 2026 года**

LaterTube — расширение Chrome и Android-приложение для личного списка видео YouTube. Ниже описано, какие данные обрабатывает LaterTube и для чего.

## Какие данные обрабатываются

Для выбранных пользователем видео LaterTube может сохранить идентификатор и ссылку YouTube, название, канал, ссылку на превью, длительность, дату публикации, количество просмотров, дату добавления и дату переноса в «Просмотрено». При явном запуске команды сбора открытых вкладок расширение проверяет их адреса и заголовки и игнорирует страницы, которые не являются видео YouTube.

## Хранение и аккаунт

Активный список и раздел «Просмотрено» (внутренний ключ `history`) хранятся под UID пользователя в Firebase Realtime Database проекта LaterTube. Правила базы разрешают авторизованному пользователю читать и изменять только `/users/<его uid>`. Один и тот же LaterTube-аккаунт по email и паролю подключает расширение и Android-приложение.

Пароль передаётся по HTTPS в Firebase Authentication и не сохраняется клиентами. Форма входа может попросить Firebase Authentication отправить на введённый адрес письмо для сброса пароля. Чтобы не требовать вход при каждом запуске, хранится refresh token Firebase; на Android он зашифрован через Android Keystore. Локально могут кэшироваться настройки интерфейса, превью YouTube и неавторитетный снимок активного списка с историей. Снимок позволяет сразу показать UI и проверить облачный `updatedAt` до загрузки полного JSON; источником истины остаётся Firebase.

Администратор Firebase-проекта технически имеет административный доступ к базе. LaterTube не использует личный список для рекламы или профилирования, не продаёт его и не открывает другим пользователям.

## Внешние запросы и передача

LaterTube отправляет данные входа и запросы списка сервисам Google Firebase. Расширение также работает на страницах YouTube и показывает превью, поэтому браузер или Android-приложение выполняют обычные HTTPS-запросы к YouTube и серверам изображений YouTube. LaterTube не добавляет идентификаторы отслеживания и не отправляет сохранённый список YouTube, рекламным системам, брокерам данных или посторонним сервисам.

## Импорт и экспорт

Выбранная резервная копия разбирается локально, после чего записи отправляются в Firebase-список вошедшего пользователя. Экспорт создаётся локально и скачивается браузером. LaterTube не отправляет файлы резервных копий на отдельный сервер разработчика.

## Добровольная поддержка

В LaterTube есть необязательный раздел «Сказать спасибо» со статическими адресами USDT и QR-кодами. Поддержка добровольная, не открывает дополнительных функций и не отслеживается. LaterTube не подключается к кошелькам и не собирает сведения о транзакциях.

## Срок хранения и удаление

При удалении из активного списка видео переносится в уникальный документ «Просмотрено». При восстановлении оно возвращается с новой датой добавления. Очистка списка переносит туда все активные записи. Отдельную запись из «Просмотрено» можно безвозвратно удалить после подтверждения. Остальные облачные данные Firebase хранятся до их удаления из проекта; локальные настройки, токен входа, UI-снимок списка и кэш превью остаются до очистки данных, выхода из аккаунта в доступных клиентах или удаления приложения.

## Разрешения

- `storage` хранит настройки интерфейса, токен входа Firebase и кэшированный UI-снимок активного списка с историей.
- `contextMenus` добавляет команду сбора открытых вкладок YouTube.
- Доступ к `youtube.com`, `youtu.be` и `ytimg.com` нужен для элементов LaterTube, метаданных выбранных видео и превью.
- Доступ к `identitytoolkit.googleapis.com` и `securetoken.googleapis.com` обеспечивает вход Firebase по email/паролю и обновление токена.
- Доступ к `firebaseio.com` и `firebasedatabase.app` синхронизирует активный список и историю вошедшего пользователя.

## Ограниченное использование данных

LaterTube использует информацию от Chrome и сервисов Google только для функции личного списка видео. Она не применяется для рекламы, оценки кредитоспособности, кредитования или посторонних целей.

## Изменения и контакты

Если правила обработки данных изменятся, эта политика и сведения в Chrome Web Store будут обновлены до введения изменений. По вопросам конфиденциальности создайте обращение в [репозитории LaterTube](https://github.com/glebster51/LaterTube/issues) или используйте контакт поддержки на странице расширения.
