# Архитектура, схема БД, безопасность и API

Техническое описание внутреннего устройства ИС «Учет материальных ценностей» для разработчиков и специалистов сопровождения.

---

## 1. Общая архитектура

Приложение построено как единый full-stack сервис на Node.js + Express (`server.ts`):

- **В режиме разработки (`npm run dev`)**: Express запускает Vite в режиме `middlewareMode: true` (`appType: 'spa'`) и обслуживает одновременно REST API (`/api/*`) и React SPA на порту `3000`.
- **В production (`npm run start`)**: предварительно собранный `dist/server.js` раздаёт статические файлы фронтенда из `dist/` и обрабатывает все маршруты `/api/*`, а неизвестные GET-пути отдаёт в `dist/index.html` для работы SPA-роутинга (включая прямые QR-ссылки вида `/equipment/:id` и `/?openGroup=...`).
- **Слой данных**: Drizzle ORM (`src/db/schema.ts`) работает поверх `pg.Pool` при наличии внешней БД (`DATABASE_URL` / `POSTGRES_URL` / `SQL_HOST`) или автоматически поднимает встроенный in-memory `@electric-sql/pglite` для локальной разработки без внешних зависимостей.

---

## 2. Схема базы данных (`src/db/schema.ts`)

### Перечисления (PostgreSQL `ENUM`)
- `role_enum`: `'ADMIN' | 'ENGINEER' | 'USER'`
- `data_type_enum`: `'STRING' | 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM'`
- `writeoff_state_enum`: `'PREPARING' | 'DOCUMENTS_PREPARATION' | 'WRITTEN_OFF'`
- `issue_state_enum`: `'ISSUE' | 'CRITICAL_ISSUE' | 'WEAR_AND_TEAR'`

### Таблицы (15 таблиц)

| Таблица | Назначение | Ключевые поля и связи |
| --- | --- | --- |
| `user` | Учётные записи сотрудников | `id`, `login` (unique), `password_hash`, `role`, `uid` (unique, optional) |
| `refresh_token` | Активные refresh-сессии | `id` (PK & FK → `user.id`, cascade), `token` (SHA-256 хеш), `created_at`, `valid_until` |
| `room` | Аудитории / кабинеты | `id`, `number`, `floor` |
| `equipment_type` | Иерархический справочник типов | `id`, `name`, `parent_id` (самоссылка на родительский тип) |
| `additional_field` | Настраиваемые поля для типов | `id`, `type_id` (FK → `equipment_type.id`), `code`, `title`, `data_type`, `is_required`, `is_multiple`, `options` (JSON), `is_active` |
| `equipment` | Основной реестр оборудования | `id`, `inventory_number` (unique), `name`, `type_id` (FK → `equipment_type.id`), `recived`, `initial_cost`, `residual_cost`, `room_id` (FK → `room.id`), `additional_fields` (JSON) |
| `equipment_writeoff` | Статус списания позиций | `equipment_id` (PK & FK → `equipment.id`, cascade), `state`, `writeoff_date` |
| `equipment_issue` | Заявки о неисправностях | `id`, `equipment_id` (FK → `equipment.id`), `state`, `description`, `broken_at`, `repaired_at` |
| `notification` | Уведомления пользователям о поломках | `id`, `user_id` (FK → `user.id`), `equipment_issue_id` (FK → `equipment_issue.id`), `created_at`, `is_read` |
| `equipment_transfer` | Журнал временного пользования | `id`, `equipment_id` (FK → `equipment.id`), `issued_to`, `issued_at`, `expected_return_at`, `returned_at` |
| `inventory` | Сессии инвентаризации | `id`, `auditor_ext_id` (FK → `user.id`), `started_at`, `finished_at` |
| `verification` | Отметки проверки оборудования в сессии | `id`, `equipment_id` (FK → `equipment.id`), `inventory_id` (FK → `inventory.id`), `verified_at` |
| `equipment_batch` | Групповые партии для общего QR-кода | `id`, `code` (unique), `name`, `equipment_ids` (JSON `number[]`), `created_at`, `room_id` |
| `audit_log` | Журнал событий и аудита безопасности | `id`, `created_at`, `actor_id` (FK → `user.id`, set null), `actor_login`, `actor_role`, `action`, `category`, `severity`, `entity_type`, `entity_id`, `entity_label`, `summary`, `details` (JSON), `ip_address`, `user_agent` |

Для `audit_log` автоматически создаются индексы по `created_at DESC`, `actor_id`, `category`, `severity`.

---

## 3. Валидация дополнительных полей (`src/server/validation.ts`)

Поле `equipment.additional_fields` (JSON) валидируется на сервере при создании/редактировании/импорте:
1. **Иерархическое наследование**: `getAllAdditionalFieldsForType(typeId)` поднимается по цепочке `parent_id` и собирает все активные поля (`is_active = true`) самого типа и всех его родительских типов.
2. **Стандартные поля кафедры** (`STANDARD_DEPARTMENT_FIELDS`): `location_place`, `dimensions`, `length_cm`, `width_cm`, `height_cm`, `description`, `color`, `status`, `condition`, `accounting_category`, `precious_metals`, `is_under_warranty`, `warranty_until`, `warranty_expired`, `warranty_status_ru`, `notes`, `quantity`, `is_kit_part`, `Наименование (по бухгалтерии)`.
3. **Сохранённые Excel-колонки**: при редактировании ранее импортированных записей передаются `preservedKeys`, чтобы не терять произвольные колонки из бухгалтерской выгрузки.

---

## 4. Механизмы безопасности (`src/server/auth.ts`, `server.ts`)

- **Обязательная аутентификация**: весь интерфейс закрыт экраном входа (`App.tsx`); все бизнес-эндпоинты защищены `requireAuth` и `requireRole(...)`.
- **JWT + HttpOnly Cookies + ротация Refresh-токенов**:
  - `access_token`: JWT HS256, срок жизни `60 минут`, передаётся в `HttpOnly` cookie (и опционально `Authorization: Bearer ...`).
  - `refresh_token`: JWT HS256 с уникальным `jti`, срок жизни `10 дней`, в базе хранится его **SHA-256 хеш** (`refresh_token.token`). При каждом `/api/auth/refresh` токен ротируется, а при обнаружении несовпадения хеша сессия отзывается с записью события `SECURITY`.
  - На каждом защищённом запросе `resolveVerifiedUserFromToken` сверяет существование пользователя в БД и берёт актуальную `role` из БД (смена/удаление роли вступает в силу немедленно).
  - Флаг `Secure` и `SameSite=none` выставляются автоматически при HTTPS (`req.secure` или `x-forwarded-proto: https`), на локальном HTTP — `SameSite=lax`.
- **Хеширование и сложность паролей**:
  - `bcryptjs` с cost factor `12`.
  - Логин: `3–64` символа, допустимы `[a-zA-Z0-9._-]`.
  - Пароль: `8–128` символов, минимум 1 буква и 1 цифра, не совпадает с логином, проверка по словарю слабых паролей (`12345678`, `qwerty123`, `admin123` и т.п.).
- **Защита от перебора и DoS**:
  - Глобальный rate limit на `/api/*`: `400` запросов в минуту с одного IP.
  - Строгий rate limit на `/api/auth/*` (кроме `/me`): `40` запросов за 15 минут с IP.
  - Блокировка подбора пароля (`failedLoginStore`): `5` неудачных попыток входа по паре `IP + login` блокируют вход на `15` минут с записью события `AUTH_BRUTEFORCE_LOCK` (`CRITICAL`).
- **Защита от CSRF и заголовки безопасности**:
  - Проверка заголовка `Origin` на всех изменяющих запросах (`POST`, `PUT`, `PATCH`, `DELETE`) относительно `Host`/`X-Forwarded-Host` и `APP_URL`.
  - Отключён `X-Powered-By`; выставляются `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, `X-Permitted-Cross-Domain-Policies: none`, `Strict-Transport-Security` (на HTTPS), `Cache-Control: no-store` для `/api/*`.
- **Защита экспорта таблиц**: при экспорте в Excel значения ячеек, начинающиеся с `=`, `+`, `-`, `@`, `\t`, `\r`, экранируются апострофом (`sanitizeSpreadsheetCell`) против Excel Formula Injection.

---

## 5. Система журналирования (`src/server/audit-logger.ts`)

События делятся на 9 категорий: `AUTH`, `SECURITY`, `ADMIN`, `EQUIPMENT`, `MAINTENANCE`, `TRANSFER`, `INVENTORY`, `WRITEOFF`, `DOCUMENT`.  
Уровни критичности: `INFO`, `WARNING`, `CRITICAL`.  
Поля вида `password`, `token`, `secret` автоматически маскируются как `[СКРЫТО]` через `sanitizeAuditDetails()`.

### Разграничение доступа к журналу по ролям

| Возможность | `ADMIN` | `ENGINEER` | `USER` |
| --- | --- | --- | --- |
| Область видимости (`scope`) | `ALL` (все события всех пользователей) | `OPERATIONAL` (операционно-технические + собственные входы) | `OWN` (только собственные входы и свои заявки о поломках) |
| Доступные категории | Все 9 категорий | `EQUIPMENT`, `MAINTENANCE`, `TRANSFER`, `INVENTORY`, `WRITEOFF`, `DOCUMENT`, `AUTH` (свои) | `AUTH` (свои), `MAINTENANCE` (свои) |
| События `SECURITY` и `ADMIN` | Да | Нет | Нет |
| IP-адрес и User-Agent | Да | Нет | Нет |
| Экспорт в `.xlsx` | Да | Да (в рамках своей области) | Нет |
| Очистка/ротация архива | Да | Нет | Нет |

---

## 6. Справочник REST API (`server.ts`)

### Системные и авторизация
- `GET /api/health` — проверка состояния сервиса и подключения к БД (`{ ok, database }`).
- `POST /api/auth/login` — вход по `login` и `password`, установка cookies и выдача данных пользователя.
- `POST /api/auth/refresh` — обновление пары `access_token`/`refresh_token`.
- `POST /api/auth/logout` — выход, удаление refresh-токена из БД и очистка cookies.
- `GET /api/auth/me` — проверка текущей сессии.
- `POST /api/auth/change-password` *(auth)* — смена собственного пароля (отзывает refresh-токен).

### Пользователи *(только `ADMIN`)*
- `GET /api/users` — список пользователей (без хешей паролей).
- `POST /api/users` — создание пользователя (`login`, `password`, `role`).
- `PUT /api/users/:id/password` — сброс пароля пользователя администратором.
- `DELETE /api/users/:id` — удаление пользователя (нельзя удалить самого себя или единственного администратора).

### Кабинеты и типы оборудования
- `GET /api/rooms` *(auth)* — список кабинетов.
- `POST /api/rooms` *(ADMIN)* — добавление кабинета (`number`, `floor`).
- `GET /api/equipment-types` *(auth)* — иерархический список типов.
- `POST /api/equipment-types` *(ADMIN)* — создание типа/подтипа.
- `PUT /api/equipment-types/:id` *(ADMIN)* — переименование и изменение родительского типа (с защитой от циклов).
- `DELETE /api/equipment-types/:id` *(ADMIN)* — удаление типа (при отсутствии связанного оборудования/подтипов).
- `GET /api/equipment-types/:id/fields` *(auth)* — поля типа (включая унаследованные от родителей).
- `POST /api/equipment-types/:id/fields` *(ADMIN)* — добавление дополнительного поля.
- `PUT /api/equipment-types/:typeId/fields/:fieldId` *(ADMIN)* — редактирование поля.
- `DELETE /api/equipment-types/:typeId/fields/:fieldId` *(ADMIN)* — деактивация/удаление поля.

### Оборудование, импорт Excel и QR
- `GET /api/equipment` *(auth)* — постраничный список с фильтрами (`search`, `roomId`, `typeId`, `includeChildTypes`, `condition`, `accountingCategory`, `preciousMetals`, `warrantyExpired`, `status`, `writeoffState`, `page`, `limit`).
- `GET /api/equipment/excel-template` *(auth)* — скачивание эталонного `.xlsx` шаблона.
- `GET /api/equipment/resolve/:code` *(auth)* — разрешение QR-кода, ссылки, инвентарного номера или ID БД в карточку оборудования или групповую партию.
- `GET /api/equipment/:id` *(auth)* — детальный паспорт оборудования (включая историю неисправностей, передач, списания, унаследованные поля).
- `POST /api/equipment` *(ADMIN)* — создание единицы оборудования.
- `PUT /api/equipment/:id` *(ADMIN)* — обновление карточки оборудования.
- `DELETE /api/equipment/:id` *(ADMIN)* — удаление единицы оборудования.
- `POST /api/equipment/bulk-delete` *(ADMIN)* — массовое удаление выбранных позиций.
- `POST /api/equipment/import-excel` *(ADMIN)* — пакетный импорт из Excel; при наличии дубликатов без флага подтверждения возвращает список совпадений для выбора стратегии (`skip` / `update`).
- `POST /api/equipment/qr-docx` *(ADMIN, ENGINEER)* — генерация `.docx` с QR-кодами выбранного оборудования и параметром размера (`sizeCm`).
- `POST /api/equipment/qr-group` *(ADMIN, ENGINEER)* — создание групповой партии предметов (`equipment_batch`).
- `GET /api/equipment/qr-group/:code` *(auth)* — получение состава групповой партии.
- `GET /api/equipment/qr-group/:code/docx` *(ADMIN, ENGINEER)* — генерация `.docx` с групповым QR-кодом и размером `sizeCm`.

### Списание и печатные формы DOCX *(ADMIN, ENGINEER)*
- `POST /api/writeoff/update-status` — перевод выбранных позиций в этап списания (`PREPARING`, `DOCUMENTS_PREPARATION`, `WRITTEN_OFF`).
- `POST /api/writeoff/generate-act` / `GET /api/writeoff/generate-act` / `GET /api/writeoff/act/:id` — генерация акта списания `.docx` (поддерживает режим автоопределения сценария и явный выбор случая 1/2/3).
- `POST /api/writeoff/generate-invoice` / `GET /api/writeoff/generate-invoice` — генерация накладной на списание `.docx`.
- `GET /api/writeoff/sample-act`, `sample-invoice`, `sample-act-case2`, `sample-invoice-case2`, `sample-act-case3` — тестовые образцы печатных форм.

### Неисправности и уведомления
- `POST /api/equipment/:id/issues` *(auth — все роли)* — регистрация неисправности по единице оборудования и рассылка уведомлений `ADMIN`/`ENGINEER`.
- `POST /api/issues/batch` *(ADMIN, ENGINEER)* — групповая регистрация неисправности по нескольким предметам.
- `GET /api/equipment/:id/issues` *(auth)* — история неисправностей предмета.
- `POST /api/issues/:issueId/repair` *(ADMIN, ENGINEER)* — закрытие неисправности (отметка о ремонте).
- `GET /api/notifications` *(auth)* — список непрочитанных уведомлений текущего пользователя.
- `DELETE /api/notifications/:id` *(auth)* — скрытие/отметка прочитанным собственного уведомления.

### Временное пользование *(ADMIN, ENGINEER, просмотр истории предмета — auth)*
- `POST /api/equipment/transfers` *(ADMIN, ENGINEER)* — выдача оборудования во временное пользование.
- `POST /api/transfers/:id/return` *(ADMIN, ENGINEER)* — отметка возврата оборудования.
- `GET /api/equipment/:id/transfers` *(auth)* — история выдач по предмету.

### Инвентаризация
- `POST /api/inventory/start` *(ADMIN, ENGINEER)* — запуск новой сессии инвентаризации.
- `GET /api/inventory/current` *(auth)* — текущая активная сессия и сводка прогресса.
- `GET /api/inventory/current/unverified` *(ADMIN, ENGINEER)* — список непроверенных позиций.
- `POST /api/inventory/:inventoryId/verify/:equipmentId` *(ADMIN, ENGINEER)* — отметка предмета проверенным.
- `POST /api/inventory/:id/finish` *(ADMIN, ENGINEER)* — завершение инвентаризации.
- `GET /api/inventory/history` *(ADMIN, ENGINEER)* — архив завершённых инвентаризаций.

### Журнал аудита
- `GET /api/audit-logs/capabilities` *(auth)* — права текущего пользователя в модуле логирования.
- `GET /api/audit-logs` *(auth)* — постраничный список событий с фильтрами (`category`, `severity`, `action`, `actorLogin`, `search`, `dateFrom`, `dateTo`, `page`, `limit`).
- `GET /api/audit-logs/export` *(ADMIN, ENGINEER)* — выгрузка журнала в `.xlsx`.
- `DELETE /api/audit-logs/purge` *(ADMIN)* — очистка/ротация записей старше указанного числа дней (`olderThanDays`).
