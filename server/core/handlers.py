from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from .exceptions import AppException
from .logging import get_logger
from .json import custom_jsonable_encoder

logger = get_logger(__name__)

async def app_exception_handler(request: Request, exc: AppException):
    logger.error("App exception", exc_info=exc)
    content = {
        "success": False,
        "message": exc.message,
        "error_code": exc.error_code,
        "details": exc.details
    }
    content = custom_jsonable_encoder(content)
    return JSONResponse(
        status_code=exc.status_code,
        content=content
    )

async def validation_exception_handler(request: Request, exc: ValidationError):
    details = []
    logger.error("Validation exception", exc_info=exc)
    for error in exc.errors():
        details.append({
            "field": " -> ".join(str(x) for x in error["loc"]),
            "message": error["msg"],
            "type": error["type"]
        })
    
    content = {
        "success": False,
        "message": "Validation error",
        "error_code": "VALIDATION_ERROR",
        "details": details
    }
    content = custom_jsonable_encoder(content)
    return JSONResponse(
        status_code=400,
        content=content
    )

async def generic_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", exc_info=exc)
    content = {
        "success": False,
        "message": "Internal server error",
        "error_code": "INTERNAL_SERVER_ERROR"
    }
    content = custom_jsonable_encoder(content)
    return JSONResponse(
        status_code=500,
        content=content
    )
