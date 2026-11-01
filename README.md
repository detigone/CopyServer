# CopyServer Pro — Discord Server Cloner

<p align="center">
  <strong>Разработка компании Lime Systems</strong><br>
  <em>Основатель: detigone</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Release-v1.2.0-5865f2?style=for-the-badge&logo=discord&logoColor=white" alt="Release v1.2.0" />
  <img src="https://img.shields.io/badge/Company-Lime%20Systems-23a55a?style=for-the-badge" alt="Lime Systems" />
  <img src="https://img.shields.io/badge/Founder-detigone-f0b232?style=for-the-badge" alt="Founder: detigone" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License: MIT" />
</p>

---

## 📖 О проекте

**CopyServer Pro** — профессиональный инструмент и плагин для клонирования Discord-серверов 1:1 с поддержкой клиентов **Vencord** и **BetterDiscord**, а также интерактивным веб-симулятором.

Разработан компанией **Lime Systems** под руководством основателя **detigone** для безопасного переноса, бэкапа и репликации архитектуры Discord-сообществ.

---

## ✨ Ключевые возможности

- 🛡️ **Создание и очистка серверов прямо из интерфейса:**
  - Кнопка **«Создать сервер»** — создаёт новый пустой сервер в Discord и моментально выбирает его целевым.
  - Кнопка **«Очистить сервер»** — безопасное и полное удаление каналов, кастомных ролей и эмодзи на целевом сервере для идеального чистого клонирования.
- 🎭 **Синхронизация ролей и прав:**
  - Сохранение полной иерархии позиций ролей.
  - Точный перенос прав `@everyone` и пользовательских ролей.
  - Поддержка расширенных цветов градиента и голографии (`primary_color`, `secondary_color`, `tertiary_color`) с валидацией ответа Discord API.
- 📁 **Дерево каналов и категорий:**
  - Двухфазное построение структуры с контролем связей `parent_id`.
  - **Скрытые и приватные каналы:** 100% перенос запретов `VIEW_CHANNEL (1024)` роли `@everyone` и прав доверенных групп.
  - **Graceful Fallback:** Если целевой сервер не является сервером сообщества (Community), каналы объявлений (`GUILD_ANNOUNCEMENT`, тип `5`), трибуны и форумы автоматически адаптируются в стандартные текстовые каналы с сохранением прав, темы и категории.
  - **Orphan Policy:** Настраиваемое поведение для каналов, чья категория была исключена (`root` — перенос в корень, `skip` — пропуск).
- 🔒 **Безопасность аккаунта (Stealth Mode):**
  - Рандомизированные задержки (джиттер 900–1500 мс) и микропаузы.
  - Маскирование Discord-токенов в логах (`[TOKEN_PROTECTED]`).
  - Адаптивный экспоненциальный backoff при получении заголовка `429 Too Many Requests (retry_after)`.
- 📝 **Водяной знак с валидацией лимита topic:**
  - Опциональная отметка в описании каналов без молчаливой обрезки оригинального текста при превышении 1024 символов.
- 🎯 **Выборочный перенос:**
  - Выбор конкретных пользовательских ролей, категорий и каналов вместо полного клонирования.
  - При выборе категории автоматически включаются её дочерние каналы; при выборе отдельного канала добавляется родительская категория.
  - Роли, используемые в permission overwrites выбранных каналов и категорий, автоматически добавляются к выбору.
- 🧩 **Объединение серверов:**
  - Несколько исходных серверов можно последовательно объединить в один выбранный целевой сервер.
  - Одноимённые роли сохраняются как отдельные роли, исходные названия каналов и категорий не меняются.
  - Для каждого источника строятся отдельные карты ID, чтобы права каналов ссылались на роли именно своего сервера.
  - Настройки сервера не смешиваются; общая роль `@everyone` берётся из первого источника. При переносе каналов необходимые роли включаются автоматически.
- 📊 **Детальный аудит и верификация:**
  - Двухфазная сверка созданных объектов с API целевого сервера.
  - Отдельный список ручной проверки (`manualReviewList`).

---

## 📁 Структура репозитория

```text
├── CopyServer.plugin.js        # Готовый плагин для BetterDiscord
├── serverCloner/
│   └── index.tsx               # Исходный код плагина для Vencord (React + TypeScript)
├── src/
│   ├── components/
│   │   ├── DiscordPluginSimulator.tsx  # Интерактивный веб-симулятор клонирования
│   │   ├── CodeViewer.tsx              # Просмотр и экспорт исходников
│   │   ├── FeaturesBreakdown.tsx       # Каталог архитектурных решений
│   │   └── InstallGuide.tsx            # Инструкция по установке
│   ├── data/                   # Моковые гильдии и сырые исходники
│   ├── App.tsx                 # Главный компонент интерфейса
│   └── main.tsx                # Точка входа React
├── tests/
│   └── cloner.test.mjs         # модульные тесты логики клонирования
├── package.json                # Спецификация пакета и скрипты
├── tsconfig.json               # Конфигурация TypeScript
├── vite.config.ts              # Конфигурация сборщика Vite
├── LICENSE                     # Лицензия MIT (Lime Systems, detigone)
└── README.md                   # Документация репозитория
```

---

## 🚀 Установка плагинов

### 1. BetterDiscord
1. Скопируйте файл `CopyServer.plugin.js`.
2. Откройте Discord: **Настройки пользователя** → **BetterDiscord** → **Плагины** → **Открыть папку плагинов**.
3. Вставьте файл `CopyServer.plugin.js` в открывшуюся папку.
4. Включите переключатель **CopyServer** в списке плагинов.

### 2. Vencord (Windows — автоматическая установка)
1. Установите Vencord и подготовьте его исходники согласно официальной инструкции Vencord.
2. Установите Node.js и pnpm, затем выполните установку зависимостей в каталоге исходников Vencord.
3. Скачайте репозиторий CopyServer и дважды откройте **`CopyServer.cmd`**.
4. Выберите действие в консольном меню. Установщик попробует найти исходники и папку Vencord автоматически; если не получится — попросит указать нужный путь.
5. После сборки откройте **Настройки Vencord** → **Плагины** и включите **ServerCloner / CopyServer**.

Требования: Windows, PowerShell, Git, Node.js, pnpm и подготовленный каталог исходников Vencord. Первый запуск требует готовых зависимостей Vencord; установщик не скачивает и не устанавливает сторонние инструменты за пользователя.

Для ручного запуска доступны `build-and-inject.ps1 -Dev`, `-NoLaunch` и `-Rollback`.

---

## 💻 Локальный запуск симулятора

Для запуска веб-интерфейса и симулятора:

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run dev

# Проверка типов TypeScript
npm run lint

# Запуск модульных тестов
npm test

# Сборка проекта
npm run build
```

---


## 📄 Structure Documents (TXT v1)

CopyServer can export a server's roles, channels, categories and permission overwrites into an editable UTF-8 `.txt` document, then create a new Discord server from that document.

### Workflow

1. Select the source server and click **«Скачать структуру текущего сервера (.txt)»**.
2. Edit the downloaded document in a text editor. Rename roles/channels, change category assignments, positions, role permissions and channel overwrites.
3. Load the edited file using **«Загрузить TXT-документ»** and run **«Проверить документ»**.
4. Click **«Создать сервер по документу»**. CopyServer creates a new guild and then rebuilds roles, categories, channels and permission overwrites in dependency order.

### Document format

The `.txt` file contains UTF-8 JSON. JSON was chosen deliberately: it is readable, editable by hand, has strict syntax, and can be validated before any Discord API request. The extension remains `.txt` for convenient handling as a text document.

Top-level fields:
- `format`: must be `copyserver-structure`.
- `version`: document schema version; currently `1`.
- `guild`: default name and description for the new server.
- `roles`: role keys, names, positions, decimal permission bitfields, colors, hoist and mentionable flags.
- `channels`: stable channel keys, type, name, position, category key, channel settings and permission overwrites.
- `exportNotes`: information about source objects that need attention.

Discord snowflake IDs are not used as role/category references inside the document. Instead, the exporter generates stable local keys such as `role_1`, `category_1` and `channel_1`. This allows the document to be reused on another server. Permission overwrites store `allow` and `deny` as separate decimal bitfield strings. Role overwrites reference local role keys; member overwrites retain the Discord user ID.

### Important behavior and limitations in v1

- Managed/integration roles are recreated as ordinary roles so their channel permission overwrites can still be mapped. They will no longer be linked to their original bot/integration.
- Role icon images are not embedded in the document.
- Unsupported Discord channel types (including active threads) are listed in `exportNotes` and omitted.
- If an overwrite refers to a role that is not represented in the document, import is blocked rather than silently dropping that permission.
- Member-specific overwrites retain the original user ID. Discord may reject them if that user cannot be referenced on the new server.
- Announcement, forum, media and stage channel types may be adapted when the destination guild lacks the required Community features.
- v1 creates a new server from a document. It does not merge a document into an existing populated server and does not copy messages, members, webhooks, integrations, emojis, server images or all guild-level settings.
- The importer reports partial completion if Discord rejects an object. It does not automatically delete already-created objects, so review the log before retrying.

## 🧪 Тестирование

Проект содержит unit-тесты, проверяющие:
- Валидацию длины водяного знака и защиту от обрезки;
- Исключение неподдерживаемых веток (`types 10, 11, 12, 6`);
- Обработку orphan-политик (`skip` и `root`);
- Верификацию `parent_id` после создания каналов;
- Маскирование токенов в логах;
- Стили ролей (`primary_color`, `secondary_color`, `tertiary_color`);
- Создание пустого сервера и фильтрацию системных ролей при очистке;
- Сохранение прав скрытых каналов (`VIEW_CHANNEL deny`);
- Выборочный перенос категорий и каналов с сохранением иерархии;
- Объединение нескольких источников с раздельными картами соответствия ролей;
- Экспорт, валидацию и импорт Structure Document TXT v1 с проверкой permission overwrite mappings;
- Адаптацию каналов объявлений в обычные текстовые для серверов без функции Сообщества.

Запуск тестов:
```bash
node --test tests/cloner.test.mjs
```

---

## 🏢 Компания и авторство

- **Компания:** Lime Systems
- **Основатель:** detigone
- **Лицензия:** [MIT License](LICENSE)

*Создано для сообщества с заботой о сохранности данных и стабильности Discord-серверов.*
