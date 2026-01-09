import os
from dataclasses import dataclass


@dataclass
class Settings:
    APP_NAME: str = os.environ.get('APP_NAME', 'FERI-AD Document Service')
    API_KEY: str = os.environ.get('API_KEY', 'changeme')
    LOG_LEVEL: str = os.environ.get('LOG_LEVEL', 'INFO')
    TEMPLATE_DIR: str = os.environ.get('TEMPLATE_DIR', 'templates')


def get_settings() -> Settings:
    return Settings()
