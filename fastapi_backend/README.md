# Высокопроизводительный бэкенд на Python + FastAPI

Данный каталог содержит полный бэкенд на Python FastAPI для ИС «Учет материальных ценностей» кафедры.

## Архитектура
- **Фреймворк**: FastAPI + Uvicorn (асинхронная обработка высокой производительности)
- **БД**: PostgreSQL (Cloud SQL) через SQLAlchemy 2.0
- **Авторизация**: JWT (Access-токен 120 минут в HttpOnly Cookie, Refresh-токен 10 суток в БД)
- **Роли**: ENUM (`ADMIN`, `ENGINEER`, `USER`)
- **Интеграции**: Генерация DOCX с QR-кодами (`python-docx` + `qrcode`), валидация Excel-импорта (`openpyxl`), жизненный цикл списания, регистрация неисправностей и инвентаризация с аудитом.

## Запуск
```bash
# 1. Установка зависимостей
pip install -r requirements.txt

# 2. Переменные окружения (подключение к PostgreSQL)
export SQL_HOST="localhost"
export SQL_USER="postgres"
export SQL_PASSWORD="your_password"
export SQL_DB_NAME="inventory_db"
export JWT_SECRET="your-jwt-secret-key"

# 3. Запуск сервера FastAPI
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Документация Swagger UI будет доступна по адресу: `http://localhost:8000/docs`.
