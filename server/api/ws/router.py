import asyncio
import json
import logging
import base64
import numpy as np
import cv2
from fastapi import APIRouter, Depends, WebSocket
from services.emotion_service import EmotionService
from services.gemini_service import GeminiService
from services.audio_service import AudioConnectionManager

from google.genai import types
from api.deps import get_gemini_service
from api.deps import get_emotion_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix='', tags=["ws"])

# Store latest emotion per client
client_emotions = {}

def is_valid_turn(turn):
    return (
        isinstance(turn, dict)
        and "role" in turn
        and "parts" in turn
        and isinstance(turn["parts"], list)
        and all(isinstance(part, dict) and "text" in part for part in turn["parts"])
    )

EMPATHY_INSTRUCTION = (
    "Whenever you receive a user's current emotion, always acknowledge it explicitly in your reply, "
    "mention the emotion, and respond with empathy and support tailored to that emotion. Never ignore the user's emotion."
)
        

def get_config_from_setup(setup_data, default_model):
    print("[DEBUG] setup_data received:", setup_data)
    model = setup_data.get("model", default_model)
    systemContext = setup_data.get("systemContext")
    config = setup_data.get("generationConfig", {"responseModalities": ["TEXT"]})
    system_instruction = setup_data.get("systemInstruction")
    tools = setup_data.get("tools")
    session_resumption = setup_data.get("sessionResumption")
    gemini_config = dict(config)
    response_modalities = gemini_config.get("responseModalities", ["TEXT"])
    if "TEXT" in response_modalities:
        model = default_model

    if systemContext:
        user_profile = systemContext.get("user_profile")
        conversation_history = systemContext.get("conversation_history")
        # Format profile for LLM
        if user_profile:
           profile_str = (
        f"The user's name is {user_profile.get('name', 'Unknown')}. "
        f"Age: {user_profile.get('age', 'Unknown')}, Gender: {user_profile.get('gender', 'Unknown')}. "
        f"Stress Frequency: {user_profile.get('stressFrequency', 'Unknown')}. "
        f"Sleep: {user_profile.get('sleep', 'Unknown')}. "
        f"Exercise: {user_profile.get('exercise', 'Unknown')}. "
        f"Triggers: {', '.join(user_profile.get('triggers', []))}. "
        f"Coping Mechanisms: {', '.join(user_profile.get('copingMechanisms', []))}. "
        f"Support System: {user_profile.get('supportSystem', 'Unknown')}. "
        f"Preferred Language: {user_profile.get('preferredLanguage', 'Unknown')}. "
        f"Response Style: {user_profile.get('responseStyle', 'Unknown')}. "
        f"Preferences: {', '.join(user_profile.get('preferences', []))}. "
        "You MUST use this information when answering questions about the user. "
        "If the user asks for their name, always use the name from the profile above. "
        "If the user asks about themselves, always refer to the profile above. "
        "Never say you don't have access to the user's information."
        "Don't use asterisks for emphasis, use all caps instead. "
        "Whenever you receive a user's current emotion, always acknowledge it explicitly in your reply, mention the emotion, and respond with empathy and support tailored to that emotion. Never ignore the user's emotion."

    )
        else:
            profile_str = ""
        history_str = ""
        if conversation_history:
            last_msgs = conversation_history[-5:]
            history_str = "Conversation so far: " + " ".join(
                f"[{msg.get('sender','')}: {msg.get('text','')}]" for msg in last_msgs
            )

        logger.info(f"[Gemini Setup] Profile info being sent: {profile_str}")
        logger.info(f"[Gemini Setup] Conversation history being sent: {history_str}")
        system_instruction = f"{profile_str}{history_str} {system_instruction or ''}".strip()

        if EMPATHY_INSTRUCTION not in system_instruction:
            system_instruction = f"{system_instruction}\n{EMPATHY_INSTRUCTION}".strip()
        if system_instruction:
            gemini_config["system_instruction"] = types.Content(parts=[types.Part(text=system_instruction)])
        if tools:
            gemini_config["tools"] = tools
        if session_resumption:
            gemini_config["session_resumption"] = types.SessionResumptionConfig(handle=session_resumption.get("handle"))
        return model, gemini_config
                # Compose system instruction
        
        if user_profile:
            system_instruction += f"User profile: {json.dumps(user_profile)}. "
            if conversation_history and isinstance(conversation_history, list) and len(conversation_history) > 0:
                last_msgs = conversation_history[-5:] if len(conversation_history) > 5 else conversation_history
                history_str = "Conversation so far: " + " ".join(
                        f"[{msg.get('sender','')}: {msg.get('text','')} ]" for msg in last_msgs
                    )
                system_instruction += history_str
        
    if system_instruction:
        gemini_config["system_instruction"] = types.Content(parts=[types.Part(text=system_instruction)])
    if tools:
        gemini_config["tools"] = tools
    if session_resumption:
        gemini_config["session_resumption"] = types.SessionResumptionConfig(handle=session_resumption.get("handle"))
    return model, gemini_config


@router.websocket("/")
async def websocket_endpoint(
    websocket: WebSocket,
    gemini_service: GeminiService = Depends(get_gemini_service),
    emotion_service: EmotionService = Depends(get_emotion_service)
):  
    import time
    active_sessions = {}
    await websocket.accept()
    client_id = f"client_{id(websocket)}"
    text_receive_task = None

    try:
        try:
            setup_msg = await websocket.receive_text()
        except Exception as e:
            logger.warning(f"[WebSocket] Client {client_id} disconnected before sending setup: {e}")
            return 

        try:
            setup_data = json.loads(setup_msg)
        except json.JSONDecodeError:
            await websocket.send_json({"error": "Invalid JSON in setup message"})
            return

        if not isinstance(setup_data, dict):
            await websocket.send_json({"error": "Setup message must be a JSON object"})
            return

        if "setup" in setup_data:
            # If it's an empty setup, this is likely an emotion-only WebSocket
            if setup_data["setup"] == {}:
                await websocket.send_json({"type": "setup_complete"})
            else:
                try:
                    model, gemini_config = get_config_from_setup(setup_data["setup"], gemini_service.model)
                    response_modalities = gemini_config.get("responseModalities", ["TEXT"])

                    if "TEXT" in response_modalities:
                        session, session_cm = await gemini_service.start_session(gemini_config, model=model)
                        import types as pytypes
                        logger.info(f"[WebSocket] session type: {type(session)} session_cm type: {type(session_cm)}")
                        logger.info(f"[WebSocket] session.receive type: {type(session.receive)}")
                        result = session.receive()
                        logger.info(f"[WebSocket] session.receive() returned: {type(result)}")

                        active_sessions[client_id] = {
                            "session": session,
                            "session_cm": session_cm,
                            "websocket": websocket,
                            "config": gemini_config,
                            "session_handle": None,
                            "initialized": True,
                            "modalities": response_modalities
                        }

                        text_receive_task = asyncio.create_task(
                            gemini_service.receive_responses(session, websocket, client_id, active_sessions)
                        )
                        logger.info(f"[WebSocket] Started TEXT modality task for {client_id}")

                    await websocket.send_json({"type": "setup_complete"})

                except Exception as session_error:
                    logger.error(f"[WebSocket] Failed to initialize session for {client_id}: {session_error}")
                    await websocket.send_json({"error": f"Session initialization failed: {str(session_error)}"})
                    return

        else:
            await websocket.send_json({"error": "First message must be setup"})
            return

        while True:
            msg = await websocket.receive_text()
            logger.info(f"[WebSocket] Received message: {msg}")

            try:
                data = json.loads(msg)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
                continue

            if not isinstance(data, dict):
                await websocket.send_json({"error": "Message must be a JSON object"})
                continue

            if "clientContent" in data:
                user_turns = data["clientContent"].get("turns", [])
                turn_complete = data["clientContent"].get("turnComplete", True)

                # Only use emotion if recently detected from a frame
                emotion_from_client = data["clientContent"].get("emotion")
                if emotion_from_client:
                    client_emotions[client_id] = emotion_from_client

                latest_emotion = client_emotions.get(client_id)
                print(f"[DEBUG] Latest emotion for {client_id}: {latest_emotion}")
                emotion_context = None  # Ensure variable is always defined
                if latest_emotion:
                    emotion_context = {
                        "role": "user",
                        "parts": [
                            {"text": f"My current emotion is {latest_emotion}."}
                        ]
                    }


                if emotion_context:
                    user_turns = user_turns + [emotion_context]

                if user_turns and all(is_valid_turn(turn) for turn in user_turns):
                    try:
                        if (client_id in active_sessions and 
                            isinstance(active_sessions[client_id], dict) and 
                            active_sessions[client_id].get("initialized", False) and
                            active_sessions[client_id]["session"] is not None):

                            session = active_sessions[client_id]["session"]
                            await gemini_service.send_client_content(session, user_turns, turn_complete)

                        else:
                            logger.error(f"[WebSocket] No text session available for {client_id}")
                            await websocket.send_json({"error": "Text session not available"})
                    except Exception as e:
                        logger.error(f"[Gemini] Error sending turns: {e}")
                        await websocket.send_json({"error": f"Failed to send content: {str(e)}"})
                else:
                    logger.error(f"[Gemini] Invalid user_turns structure: {user_turns}")
                    await websocket.send_json({"error": "Invalid message format for Gemini"})

            elif data.get("type") == "setup":
                await websocket.send_json({"type": "setup_complete"})

            elif "frame" in data:
                try:
                    frame_b64 = data["frame"]
                    logger.info(f"[Emotion] Received frame base64 length: {len(frame_b64)}")
                    # Decode base64 to bytes
                    img_bytes = base64.b64decode(frame_b64)
                    logger.info(f"[Emotion] Decoded image bytes length: {len(img_bytes)}")
                    # Convert bytes to numpy array
                    with open("debug_frame.png", "wb") as f:
                        f.write(img_bytes)

                    np_arr = np.frombuffer(img_bytes, np.uint8)
                    logger.info(f"[Emotion] Numpy array shape: {np_arr.shape}, dtype: {np_arr.dtype}")
                    # Decode image (PNG)
                    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                    if frame is None:
                        logger.error("[Emotion] Failed to decode frame (cv2.imdecode returned None)")
                        await websocket.send_json({"error": "Invalid frame"})
                        continue
                    logger.info(f"[Emotion] Frame shape: {frame.shape}, dtype: {frame.dtype}, mean: {frame.mean()}")
                    if frame.mean() < 5.0:
                        logger.warning("[Emotion] Received a completely black frame. Skipping emotion analysis.")
                        await websocket.send_json({"error": "Black frame received"})
                        continue

                    current_emotion = emotion_service.analyze_frame(frame)
                    aggregated = emotion_service.get_aggregated_emotion()

                    # Store latest emotion and timestamp for this client
                    client_emotions[client_id] = {
                        "current": current_emotion,
                        "aggregated": aggregated,
                        "timestamp": time.time()
                    }

                    logger.info(f"[Emotion] Captured: current={current_emotion}, aggregated={aggregated}")
                    await websocket.send_json({
                        "emotion": {
                            "current": current_emotion,
                            "aggregated": aggregated
                        }
                    })
                except Exception as e:
                    logger.exception("[Emotion] Exception during frame processing")
                    await websocket.send_json({"error": "Emotion processing failed"})


            else:
                await websocket.send_json({"error": "Unsupported message format"})

    except Exception as e:
        logger.error(f"Error handling client {client_id}: {e}")

    finally:
        if text_receive_task and not text_receive_task.done():
            text_receive_task.cancel()
            try:
                await text_receive_task
            except asyncio.CancelledError:
                pass
            except Exception as task_error:
                logger.error(f"Error cancelling text receive task for {client_id}: {task_error}")

        if client_id in active_sessions:
            try:
                session_data = active_sessions[client_id]
                if isinstance(session_data, dict) and "session_cm" in session_data and session_data["session_cm"]:
                    session_cm = session_data["session_cm"]
                    await session_cm.__aexit__(None, None, None)
                else:
                    logger.info(f"[WebSocket] No session context manager to clean up for {client_id}")
            except Exception as cleanup_error:
                logger.error(f"Error cleaning up session for {client_id}: {cleanup_error}")
            del active_sessions[client_id]

        if client_id in client_emotions:
            del client_emotions[client_id]

        logger.info(f"[WebSocket] Cleanup completed for {client_id}")


audio_manager = AudioConnectionManager()
audio_client_emotions = {}  # Store latest emotion per audio client

@router.websocket("/audio")
async def audio_websocket_endpoint(websocket: WebSocket):
    client_id = f"audio_client_{id(websocket)}"
    try:
        await audio_manager.connect(websocket)
        user_profile = None
        conversation_history = None
        session_cm = None
        session = None
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "setup":
                config = message.get("config", {})
                system_context = config.get("systemContext")
                user_profile = None
                conversation_history = None
                if system_context:
                    user_profile = system_context.get("user_profile")
                    conversation_history = system_context.get("conversation_history")
                # Compose system instruction
                system_instruction = "You are a Therapist"
                if user_profile:
                    system_instruction += f"User profile: {json.dumps(user_profile)}. "
                if conversation_history and isinstance(conversation_history, list) and len(conversation_history) > 0:
                    last_msgs = conversation_history[-5:] if len(conversation_history) > 5 else conversation_history
                    history_str = "Conversation so far: " + " ".join(
                        f"[{msg.get('sender','')}: {msg.get('text','')} ]" for msg in last_msgs
                    )
                    system_instruction += history_str
                # Start Gemini session
                gemini_client = audio_manager.active_connections.get(websocket)
                if gemini_client:
                    await gemini_client.send_setup(config, system_instruction)
                await websocket.send_json({"type": "setup_complete"})

            elif message.get("type") == "audio_input":
                audio_data = message.get("audio_data", "")
                # If the message has an explicit end_of_stream flag, use it; otherwise, always send True for now
                end_of_stream = message.get("end_of_stream", True)
                if audio_data:
                    gemini_client = audio_manager.active_connections.get(websocket)
                    if gemini_client:
                        await gemini_client.send_audio(audio_data, end_of_stream=end_of_stream)

            elif message.get("type") == "text_input":
                text = message.get("text", "")
                # Add emotion context if available, similar to "/" endpoint
                latest_emotion = audio_client_emotions.get(client_id)
                if latest_emotion:
                    emotion_context = f"My current emotion is {latest_emotion}. "
                    text = f"{emotion_context}{text}"
                if text:
                    gemini_client = audio_manager.active_connections.get(websocket)
                    if gemini_client:
                        await gemini_client.send_text(text)

    except Exception:
        await audio_manager.disconnect(websocket)
    finally:
        if client_id in audio_client_emotions:
            del audio_client_emotions[client_id]
