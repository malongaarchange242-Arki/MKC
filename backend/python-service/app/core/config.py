import os
from dataclasses import dataclass

@dataclass
class Settings:
    APP_NAME: str = os.environ.get('APP_NAME', 'FERI-AD Document Service')
    PYTHON_SERVICE_API_KEY: str = os.environ.get('PYTHON_SERVICE_API_KEY')
    LOG_LEVEL: str = os.environ.get('LOG_LEVEL', 'INFO')
    TEMPLATE_DIR: str = os.environ.get('TEMPLATE_DIR', 'templates')

def get_settings() -> Settings:
    if not os.environ.get('PYTHON_SERVICE_API_KEY'):
        raise RuntimeError("PYTHON_SERVICE_API_KEY is not set")
    return Settings()
