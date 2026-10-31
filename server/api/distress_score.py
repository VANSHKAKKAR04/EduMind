from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services.distress_service import llm_distress_score
from typing import List, Dict, Any,Optional

router = APIRouter()
class Message(BaseModel):
    sender: str
    type: str
    text: str
    timestamp: Optional[str] = None
    emotion: Optional[str] = None
    distress: Optional[float] = None

class DistressRequest(BaseModel):
    text: str
    conversationHistory: Optional[List[Message]] = None

@router.post("/api/distress-score")
async def distress_score_endpoint(request: DistressRequest):
    try:
        score = llm_distress_score(request.text,request.conversationHistory)
        return {"score": score}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
