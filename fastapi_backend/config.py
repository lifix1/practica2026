import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "ИС «Учет материальных ценностей»"
    DEBUG: bool = True
    
    # Database connection parameters (matches Cloud SQL environment variables)
    SQL_HOST: str = os.getenv("SQL_HOST", "localhost")
    SQL_USER: str = os.getenv("SQL_USER", "postgres")
    SQL_PASSWORD: str = os.getenv("SQL_PASSWORD", "postgres")
    SQL_DB_NAME: str = os.getenv("SQL_DB_NAME", "inventory_db")
    
    # JWT Settings (per technical specification)
    SECRET_KEY: str = os.getenv("JWT_SECRET", "university-inventory-system-secret-key-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120  # 120 minutes as specified in PDF
    REFRESH_TOKEN_EXPIRE_DAYS: int = 10     # 10 days as specified in PDF
    
    @property
    def DATABASE_URL(self) -> str:
        if self.SQL_HOST.startswith("/"):
            # Unix domain socket for Cloud SQL Proxy
            return f"postgresql://{self.SQL_USER}:{self.SQL_PASSWORD}@/{self.SQL_DB_NAME}?host={self.SQL_HOST}"
        return f"postgresql://{self.SQL_USER}:{self.SQL_PASSWORD}@{self.SQL_HOST}/{self.SQL_DB_NAME}"

settings = Settings()
