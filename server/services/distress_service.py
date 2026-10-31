import os
import google.generativeai as genai
import re
import json
from typing import List, Dict
from core.config import settings

GEMINI_API_KEY = settings.GEMINI_API_KEY

# Configure Gemini API
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)



def llm_distress_score(text: str,conversationHistory: List[Dict]) -> float:
    prompt = f"""
You are an expert mental health assessment assistant. Your task is to evaluate the user's current level of emotional distress based on their latest message and the recent conversation history.

Instructions:
- Carefully consider the user's most recent input as well as the context provided by the conversation history.
- Pay attention to signs of emotional intensity, negative language, hopelessness, anxiety, or any mention of self-harm or crisis.
- Consider both explicit statements and subtle cues in the user's language.
- If the user appears calm, positive, or neutral, assign a lower score.
- If the user expresses severe distress, hopelessness, or risk of harm, assign a higher score.
- Use the conversation history to understand the user's emotional trajectory and whether their distress is increasing, decreasing, or stable.

Scoring:
- 0: Emotionally stable, calm, or positive.
- 1-3: Mild distress, some negative emotion but coping.
- 4-6: Moderate distress, clear signs of struggle or anxiety.
- 7-9: High distress, strong negative emotions, possible risk factors.
- 10: Extreme distress, crisis, or immediate risk of harm.

Respond ONLY with a single number between 0 and 10. Do not include any explanation or text.

User Input:
{text}

Recent Conversation History:
{conversationHistory}
"""
    try:
        model = genai.GenerativeModel('models/gemini-1.5-flash')
        response = model.generate_content(prompt)
        raw_text = response.text.strip()
        # Extract the first number between 0 and 10
        match = re.search(r'([0-9]+(?:\.[0-9]+)?)', raw_text)
        if match:
            score = float(match.group(1))
            score = max(0, min(10, score))
            return score
        else:
            return 0.0
    except Exception as e:
        return 0.0