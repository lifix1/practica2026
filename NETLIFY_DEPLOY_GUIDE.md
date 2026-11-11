# 🚀 Руководство по деплою проекта на Netlify

В проект уже добавлены все необходимые файлы для деплоя на Netlify:
* **`netlify.toml`** — конфигурация сборщика, папки публикации `dist` и правил проксирования;
* **`netlify/functions/api.ts`** — serverless-адаптер (`serverless-http`), запускающий бэкенд Express в виде Netlify Functions;
* **`public/_redirects`** — правила перенаправления для SPA и API.

---

## ⚡ Главное: Что нужно знать о Netlify

1. **Netlify хостит статику и Serverless-функции**, но **НЕ предоставляет встроенную базу данных PostgreSQL**.
2. Поэтому для данных вам понадобится бесплатная облачная база данных PostgreSQL (создается за 1 минуту, например на **[Neon.tech](https://neon.tech/)** или **[Supabase](https://supabase.com/)**).
3. **Нужен ли PORT?**  
   **НЕТ!** На Netlify переменную `PORT` указывать **не нужно**. Запросы к API и страницам обрабатываются платформой автоматически по HTTPS.

---

## 🔑 Какие переменные окружения (Environment Variables) задать на Netlify

В панели управления Netlify перейдите в:  
👉 **Site configuration** ➔ **Environment variables** ➔ **Add a variable**

Добавьте 4 переменные:

| Переменная | Пример значения | Для чего нужна |
| :--- | :--- | :--- |
| **`DATABASE_URL`** | `postgresql://user:pass@ep-cool-sample.eu-central-1.aws.neon.tech/neondb?sslmode=require` | Строка подключения к вашей облачной базе данных PostgreSQL (Neon, Supabase или др.). |
| **`APP_URL`** | `https://ваш-проект.netlify.app` | Реальный публичный адрес вашего сайта на Netlify. Необходим для генерации рабочих ссылок в QR-кодах и корректной работы безопасных авторизационных cookies. |
| **`JWT_SECRET`** | `u8f$9K2!mZ7@pL9#qR4&vX1*sC3^bN6(` | Любая случайная надежная строка (32+ символа) для криптографической подписи JWT-токенов входа. |
| **`NODE_ENV`** | `production` | Включает оптимизированный режим работы библиотек. |

> ⚠️ **Важно:** Переменные `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD` задавать не обязательно — если указана `DATABASE_URL`, система автоматически использует её.

---

## 📝 Пошаговая инструкция с нуля

### Шаг 1. Создание бесплатной базы данных PostgreSQL (например, на Neon.tech)

1. Перейдите на **[neon.tech](https://neon.tech/)** и войдите через GitHub или Google (бесплатно, без кредитной карты).
2. Нажмите **«Create Project»**, задайте имя (например, `university-inventory`).
3. Скопируйте строку подключения (**Connection string**) формата:
   ```text
   postgresql://alex:password123@ep-cool-sample-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
   *Сохраните её — это ваше значение для `DATABASE_URL`.*

---

### Шаг 2. Развертывание таблиц в облачной базе (разово с вашего ПК)

Перед первым запуском необходимо создать таблицы в новой облачной базе:

Откройте терминал на компьютере в папке проекта и выполните:
```bash
# Windows PowerShell:
$env:DATABASE_URL="ваша_строка_от_neon"; npm run db:push

# Linux / macOS:
DATABASE_URL="ваша_строка_от_neon" npm run db:push
```
*Команда создаст в облачной базе все таблицы (`users`, `equipment`, `rooms`, `equipment_types` и т.д.).*

---

### Шаг 3. Загрузка кода в GitHub / GitLab

1. Создайте новый репозиторий на GitHub.
2. Загрузите проект в репозиторий:
   ```bash
   git init
   git add .
   git commit -m "feat: prepare project for netlify deployment"
   git branch -M main
   git remote add origin https://github.com/<ваш_логин>/<имя_репозитория>.git
   git push -u origin main
   ```

---

### Шаг 4. Подключение репозитория к Netlify

1. Зайдите в аккаунт на **[netlify.com](https://www.netlify.com/)**.
2. Нажмите кнопку **«Add new site»** ➔ **«Import an existing project»**.
3. Выберите **GitHub** и найдите ваш репозиторий.
4. Настройки сборки Netlify подставит автоматически из файла `netlify.toml`:
   * **Build command**: `npm run build`
   * **Publish directory**: `dist`
   * **Functions directory**: `netlify/functions`
5. Нажмите кнопку **«Add environment variables»** и внесите 4 переменные из таблицы выше (`DATABASE_URL`, `APP_URL`, `JWT_SECRET`, `NODE_ENV`).
   *(Если адрес сайта на Netlify ещё неизвестен, укажите пока временный, а после генерации домена обновите `APP_URL`)*.
6. Нажмите кнопку **«Deploy site»**.

---

### Шаг 5. Проверка работы

После завершения деплоя (1-2 минуты):
1. Откройте ссылку вашего сайта (например, `https://inventory-system-123.netlify.app`).
2. В файле `Site configuration` ➔ `Change site name` можно задать красивый поддомен. Не забудьте обновить `APP_URL` в Environment variables, если поменяли имя сайта!
3. Войдите под администратором:
   * **Логин**: `admin`
   * **Пароль**: `admin123`
4. Проверьте:
   * Открытие паспортов оборудования;
   * Генерацию QR-кодов и карточек Word;
   * Редактирование типов и дополнительных полей;
   * Списание и проведение инвентаризации.

---

## 💡 Альтернативный вариант (Netlify для фронтенда + Render/Railway для бэкенда)

Если вы предпочитаете постоянный Node.js сервер вместо Serverless-функций:
1. Задеплойте бэкенд на **Render.com** или **Railway.app** (команда запуска `npm run start`).
2. В файле `netlify.toml` измените перенаправление:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "https://your-backend.onrender.com/api/:splat"
     status = 200
     force = true

   [[redirects]]
     from = "/q/*"
     to = "https://your-backend.onrender.com/q/:splat"
     status = 200
     force = true
   ```
3. Фронтенд на Netlify будет прозрачно пересылать все вызовы на ваш отдельный бэкенд без проблем с CORS.
