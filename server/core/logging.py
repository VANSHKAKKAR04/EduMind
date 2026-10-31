import logging
import sys
from typing import Any
import structlog
from pythonjsonlogger import jsonlogger
from .config import settings
import elasticapm
# from elasticapm.handlers.logging import ElasticAPMHandler

def setup_logging() -> None:
    # Set up root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(settings.LOG_LEVEL)

    # Clear any existing handlers
    root_logger.handlers.clear()

    # Common processors for structlog
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]

    # Console logging
    if settings.ENABLE_CONSOLE_LOGGING:
        console_handler = logging.StreamHandler(sys.stdout)
        if settings.LOG_FORMAT == "json":
            formatter = jsonlogger.JsonFormatter(
                "%(timestamp)s %(level)s %(name)s %(message)s"
            )
            console_handler.setFormatter(formatter)
            processors.append(structlog.processors.JSONRenderer())
        else:
            processors.append(structlog.dev.ConsoleRenderer())
        
        root_logger.addHandler(console_handler)

    # File logging
    if settings.ENABLE_FILE_LOGGING and settings.LOG_FILE_PATH:
        file_handler = logging.FileHandler(settings.LOG_FILE_PATH)
        file_formatter = jsonlogger.JsonFormatter(
            "%(timestamp)s %(level)s %(name)s %(message)s"
        )
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)

    # Elastic APM logging
    if settings.ELASTIC_APM_ENABLED:
        elasticapm.instrument()
        client = elasticapm.Client(
            service_name=settings.ELASTIC_APM_SERVICE_NAME,
            server_url=settings.ELASTIC_APM_SERVER_URL,
            environment=settings.ELASTIC_APM_ENVIRONMENT
        )
        # apm_handler = elasticapm.handlers.logging.ElasticAPMHandler(client=client)
        # root_logger.addHandler(apm_handler)

    # Configure structlog
    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

def get_logger(name: str) -> Any:
    return structlog.get_logger(name)

def get_request_id() -> str:
    return structlog.contextvars.get_contextvars().get("request_id", "unknown")