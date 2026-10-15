# PgmzChat 1.0_Beta6

В архив входит Android-проект, браузерный/PWA-клиент, Node.js сервер, локальная HTML-админка и подготовленная конфигурация временного развёртывания Render.

## Быстрый старт хостинга

Самый простой подготовленный вариант — **Render + PostgreSQL**. Следуй инструкции `DEPLOY_TEMP_FREE.md`: загрузи папку проекта в новый GitHub-репозиторий, создай Blueprint в Render и запусти `render.yaml`. После запуска корневой HTTPS-адрес открывает сам веб-клиент, а `/api/health` проверяет сервер.

Файл админки для компьютера: `admin/admin.html`. Открой локально в браузере, укажи адрес сервера и секрет `PGMZCHAT_ADMIN_TOKEN` из настроек сервиса. Файл не хранит токен в `localStorage` или cookies. Не загружай админку на публичный сайт и не публикуй секрет.

## Что хранится на сервере

При наличии `DATABASE_URL` учётные данные и коды устройств сохраняются в PostgreSQL. При локальном запуске без `DATABASE_URL` используется `server/data/accounts.json` и `server/data/devices.json`. В обоих режимах хранятся только аккаунтный минимум (ID, username, соль и хеш пароля) и учёт устройств/банов. Тексты сообщений, история, контакты, каналы, стикеры и медиа не записываются на сервер.

Сессии, онлайн-присутствие и сигналы WebRTC хранятся только в памяти, а значит сбрасываются при перезапуске. Бесплатная Render PostgreSQL действует 30 дней; бесплатный Web Service засыпает после 15 минут без запросов. Эти ограничения описаны в `DEPLOY_TEMP_FREE.md`.

## Android APK из Termux

Скачай `PgmzChat_1.0_Beta6_Source.zip` в «Загрузки» телефона. Затем в Termux:

```bash
termux-setup-storage
pkg update -y
pkg install -y unzip nodejs openjdk-21 gradle
cd ~/storage/downloads
unzip -o PgmzChat_1.0_Beta6_Source.zip
cd ~/storage/downloads/PgmzChat_1.0_Beta6
bash verify-source.sh
bash build-termux.sh
```

Сборка использует Android SDK 34, `applicationId` остаётся `com.pgmzchat.app`, версия `1.0_Beta6`, `versionCode 43`. Скрипт проверяет APK и копирует его в `~/storage/downloads/PgmzChat-1.0_Beta6-debug.apk`. Подпись debug APK должна совпадать с установленной сборкой, чтобы обновление прошло поверх предыдущей.

## Проверка и предупреждения

```bash
bash verify-source.sh
```

Проверки охватывают синтаксис клиентского и серверного JS, server smoke tests, локальные media/profile/search checks, синхронизацию Web-клиента с Android assets, HTML-админку и версии APK. Они не заменяют реальный тест со вторым устройством, внешнюю проверку работы P2P через разные сети или аудит безопасности.

Это экспериментальная Beta-сборка, а не production-ready защищённый мессенджер. В текущей P2P-архитектуре не настроен TURN, поэтому часть мобильных сетей/NAT/firewall может блокировать соединения; гарантированной фоновой доставки нет. Для чувствительных разговоров не используй этот временный стенд до полноценного аудита.
