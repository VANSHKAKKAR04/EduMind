import cv2
import numpy as np
from collections import deque, Counter
from typing import Deque, Dict
import logging

logger = logging.getLogger(__name__)

_deepface = None
_deepface_load_error = None


def get_deepface():
    global _deepface, _deepface_load_error
    if _deepface_load_error is not None:
        raise _deepface_load_error
    if _deepface is None:
        try:
            from deepface import DeepFace

            _deepface = DeepFace
        except Exception as exc:
            _deepface_load_error = exc
            raise
    return _deepface

class EmotionService:
    def __init__(self, buffer_size: int = 10):
        self.buffer: Deque[str] = deque(maxlen=buffer_size)

    def analyze_frame(self, frame: np.ndarray) -> str:
        try:
            deepface = get_deepface()
            result = deepface.analyze(frame, actions=["emotion"], 
            enforce_detection=False)
            logger.info(f"[Emotion] DeepFace result: {result}")
            # Handle both dict and list return types
            if isinstance(result, dict):
                emotion = result.get("dominant_emotion", "unknown")
            elif isinstance(result, list) and result:
                emotion = result[0].get("dominant_emotion", "unknown")
            else:
                emotion = "unknown"
            self.buffer.append(emotion)
            return emotion
        except Exception as e:
            logger.warning(f"Emotion analysis failed: {e}")
            return "unknown"

    def get_aggregated_emotion(self) -> str:
        if not self.buffer:
            return "neutral"
        most_common = Counter(self.buffer).most_common(1)
        return most_common[0][0]
