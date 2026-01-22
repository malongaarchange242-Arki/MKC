import logging
import inspect
from core.config import get_settings


def configure_logging():
    settings = get_settings()
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def get_logger(name: str | None = None) -> logging.Logger:
    """Return a logger named for the caller module when `name` is None.

    This keeps call sites simple (`get_logger()`) while producing useful
    logger names originating from the module that requested the logger.
    """
    if name:
        return logging.getLogger(name)

    # fall back to caller module name
    frame = inspect.stack()[1]
    module = inspect.getmodule(frame[0])
    mod_name = module.__name__ if module else "app"
    return logging.getLogger(mod_name)
