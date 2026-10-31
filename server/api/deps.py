from services.gemini_service import GeminiService
from services.emotion_service import EmotionService
from services.emotion_service import EmotionService

from core.config import settings

class DependencyStorage:

    def __init__(self, api_key, gemini_model):
        self.api_key = api_key
        self.gemini_model = gemini_model

        self._gemini_service = GeminiService(api_key=api_key, model=gemini_model)
        self._emotion_service = EmotionService()  # <-- Singleton instance

    

    def get_gemini_service(self) -> GeminiService:
        return self._gemini_service
    def get_emotion_service(self)->EmotionService:
        return self._emotion_service
    
async def initialize_dependencies():
    global dependency_storage
    dependency_storage = DependencyStorage(
        api_key=settings.GEMINI_API_KEY,
        gemini_model=settings.GEMINI_TEXT_MODEL or settings.GEMINI_MODEL,
    )

def get_gemini_service() -> GeminiService:
    if dependency_storage is None:
        raise RuntimeError("Dependencies not initialized")
    return dependency_storage.get_gemini_service()

def get_emotion_service() -> EmotionService:
    if dependency_storage is None:
        raise RuntimeError("Dependencies not initialized")
    return dependency_storage.get_emotion_service()
