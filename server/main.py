from fastapi import FastAPI, Request,WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from contextlib import asynccontextmanager
import uuid
import structlog
import os
import logging
import asyncio
from datetime import datetime, date
from core.config import settings
from core.logging import setup_logging, get_logger
from core.exceptions import AppException
from core.handlers import app_exception_handler, validation_exception_handler, generic_exception_handler
from starlette.middleware.trustedhost import TrustedHostMiddleware
from api.deps import initialize_dependencies
from api.ws.router import router as ws_router
from api import distress_score




@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    try:
        await initialize_dependencies()
        yield
    
    except Exception as e:
        raise

class CustomJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        from core.json import custom_jsonable_encoder  # Fixed import
        return super().render(custom_jsonable_encoder(content))

app = FastAPI(
    title="Mental System Backend",
    description="Backend API for Eduviva",
    version="1.0.0",
    lifespan=lifespan,
    default_response_class=CustomJSONResponse
)

# Exception Handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(ValidationError, validation_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

app.include_router(ws_router)
app.include_router(distress_score.router)


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


