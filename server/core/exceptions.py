from typing import Any, Dict, Optional

class AppException(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 500,
        error_code: str = "INTERNAL_SERVER_ERROR",
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)

class InvalidCredentialsException(AppException):
    def __init__(self, message: str = "Invalid credentials"):
        super().__init__(
            message=message,
            status_code=401,
            error_code="INVALID_CREDENTIALS"
        )

class UnauthorizedException(AppException):
    def __init__(self, message: str = "Unauthorized access"):
        super().__init__(
            message=message,
            status_code=401,
            error_code="UNAUTHORIZED"
        )

class ForbiddenException(AppException):
    def __init__(self, message: str = "Access forbidden"):
        super().__init__(
            message=message,
            status_code=403,
            error_code="FORBIDDEN"
        )

class DuplicateRequestException(AppException):
    def __init__(self, message: str = "Duplicate Request", details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            status_code=409,
            error_code="CONFLICT",
            details=details
        )

class NotFoundException(AppException):
    def __init__(self, message: str = "Resource not found", details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            status_code=404,
            error_code="NOT_FOUND",
            details=details
        )



class InvalidRequestException(AppException):
    def __init__(self, message: str = "Invalid request", details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            status_code=400,
            error_code="INVALID_REQUEST",
            details=details
        )



class ValidationException(AppException):
    def __init__(self, message: str = "Validation error", details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            status_code=422,
            error_code="VALIDATION_ERROR",
            details=details
        )

