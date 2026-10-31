# services/gemini_token_manager.py

import os
from google.oauth2 import service_account
from google.auth.transport.requests import Request

SERVICE_ACCOUNT_FILE = "mental-sys-b82435771303.json"
SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/generative-language"
]

class GeminiTokenManager:
    def __init__(self, service_account_file=SERVICE_ACCOUNT_FILE, scopes=SCOPES):
        self.credentials = service_account.Credentials.from_service_account_file(
            service_account_file, scopes=scopes
        )

    def get_access_token(self):
        if not self.credentials.valid or self.credentials.expired:
            self.credentials.refresh(Request())
        return self.credentials.token

# Usage example:
if __name__ == "__main__":
    manager = GeminiTokenManager()
    print("Access Token:", manager.get_access_token())