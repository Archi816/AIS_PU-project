"""Shared credential for backend-to-backend requests, not student login sessions."""
import secrets
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from app.config import settings

header = APIKeyHeader(name='X-Service-Key', auto_error=False)


def require_service_key(provided: str | None = Security(header)):
    expected = (settings().get('LEMS_SERVICE_API_KEY') or '').strip()
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail={
            'code': 'SERVICE_NOT_CONFIGURED', 'message': 'Service access key is not configured.'})
    if not provided or not secrets.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail={
            'code': 'UNAUTHORIZED', 'message': 'A valid X-Service-Key header is required.'})
