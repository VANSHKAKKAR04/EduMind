import asyncio
import json
import logging
from xml.parsers.expat import model
from google import genai
from google.genai import types


logger = logging.getLogger(__name__)

class GeminiService:
    def __init__(self, api_key, model="gemini-live-2.5-flash-preview"):
        self.client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(api_version="v1alpha"),
        )
        self.model = model

    async def start_session(self, config, model=None):
        # Enable context window compression with a sliding window
        # If config is a dict, build a LiveConnectConfig object
        if isinstance(config, dict):
            config = types.LiveConnectConfig(
                **{k: v for k, v in config.items() if k != 'context_window_compression'},
                context_window_compression=types.ContextWindowCompressionConfig(
                    sliding_window=types.SlidingWindow()
                )
            )
        else:
            config.context_window_compression = types.ContextWindowCompressionConfig(
                sliding_window=types.SlidingWindow()
            )
        model_to_use = model or self.model
        session_cm = self.client.aio.live.connect(model=model_to_use, config=config)
        session = await session_cm.__aenter__()
        return session, session_cm

    
    async def send_client_content(self, session, turns, turn_complete=True):
        # Defensive: Validate structure before sending
        if not isinstance(turns, list):
            logger.error(f"[GeminiService] 'turns' is not a list: {turns}")
            return
        for i, turn in enumerate(turns):
            if not isinstance(turn, dict) or "role" not in turn or "parts" not in turn:
                logger.error(f"[GeminiService] Invalid turn at index {i}: {turn}")
                return
            if not isinstance(turn["parts"], list):
                logger.error(f"[GeminiService] 'parts' is not a list at index {i}: {turn['parts']}")
                return
            for j, part in enumerate(turn["parts"]):
                if not isinstance(part, dict) or "text" not in part:
                    logger.error(f"[GeminiService] Invalid part at turn {i}, part {j}: {part}")
                    return

        print("[GeminiService] Sending to Gemini (raw dict, multi-turn):", turns, "turn_complete:", turn_complete)
        await session.send_client_content(turns=turns, turn_complete=turn_complete)

    async def _safe_websocket_send(self, websocket, client_id, data_dict):
        """Safely send data to websocket with proper error handling"""
        try:
            if not isinstance(data_dict, dict):
                logger.error(f"[Gemini] Expected dict for websocket send, got {type(data_dict)} for client {client_id}")
                return False
            
            if not websocket or not hasattr(websocket, 'send'):
                logger.error(f"[Gemini] Invalid websocket object for client {client_id}")
                return False
            
            # payload = json.dumps(data_dict)
            # await websocket.send(payload)
            await websocket.send_json(data_dict)
            return True
        except Exception as e:
            logger.error(f"[Gemini] Safe websocket send failed for {client_id}: {e}")
            logger.error(f"[Gemini] Data being sent: {data_dict}")
            logger.error(f"[Gemini] Websocket type: {type(websocket)}")
            return False
    
    async def receive_responses(self, session, websocket, client_id, active_sessions, api_key=None, config=None):
        """
        After every Gemini response, close and reconnect the Gemini session using the latest session handle (if available).
        This acts as a heartbeat/forced reconnect to ensure session continuity.
        """
        # Input validation
        if not websocket or not hasattr(websocket, 'send'):
            logger.error(f"[Gemini] Invalid websocket object for client {client_id}")
            return
            
        if not isinstance(client_id, str):
            logger.error(f"[Gemini] Invalid client_id type: {type(client_id)}, value: {client_id}")
            return
            
        if not isinstance(active_sessions, dict):
            logger.error(f"[Gemini] Invalid active_sessions type: {type(active_sessions)}")
            return
        
        try:
            # FIXED: Ensure active_sessions[client_id] is properly initialized as a dict
            # and handle the case where it might be a string or other type
            if client_id not in active_sessions:
                active_sessions[client_id] = {}
            elif not isinstance(active_sessions[client_id], dict):
                logger.warning(f"[Gemini] active_sessions[{client_id}] is not a dict, reinitializing: {type(active_sessions[client_id])}")
                active_sessions[client_id] = {}
            
            while True:
                async for response in session.receive():
                    # Defensive: If response is bytes, decode to string
                    if isinstance(response, bytes):
                        response_str = response.decode('utf-8', errors='replace')
                        logger.error(f"[Gemini] Received unexpected bytes response for {client_id}: {response_str}")
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "error",
                            "message": f"Unexpected Gemini API response: {response_str}"
                        })
                        continue
                        
                    # Defensive: If response is a string, log and skip
                    elif isinstance(response, str):
                        logger.error(f"[Gemini] Received unexpected string response for {client_id}: {response}")
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "error",
                            "message": f"Unexpected Gemini API response: {str(response)}"
                        })
                        continue
                    
                    # Print for all message types
                    elif hasattr(response, "session_resumption_update") and response.session_resumption_update:
                        handle = response.session_resumption_update.new_handle
                        resumable = response.session_resumption_update.resumable
                        
                        # FIXED: Double-check that active_sessions[client_id] is still a dict before accessing
                        if not isinstance(active_sessions.get(client_id), dict):
                            logger.warning(f"[Gemini] active_sessions[{client_id}] became non-dict, reinitializing")
                            active_sessions[client_id] = {}
                        
                        active_sessions[client_id]["session_handle"] = handle
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "session_resumption_update",
                            "handle": handle,
                            "resumable": resumable
                        })
                    
                    elif getattr(response, "go_away", None):
                        print(f"[GeminiService] Received go_away for {client_id}: {response.go_away}")
                        
                        # FIXED: More robust handling of session_handle access
                        session_handle = None
                        client_data = active_sessions.get(client_id)
                        if isinstance(client_data, dict):
                            session_handle = client_data.get("session_handle")
                        else:
                            logger.warning(f"[Gemini] active_sessions[{client_id}] is not a dict when accessing session_handle: {type(client_data)}")
                        
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "session_warning",
                            "message": f"Session ending in: {getattr(response.go_away, 'time_left', None)}",
                            "go_away": str(response.go_away),
                            "resume_handle": session_handle
                        })
                    
                    elif getattr(response, "text", None) is not None:
                        print(f"[GeminiService] Received text for {client_id}: {response.text}")
                        print(response.text)
                        # Always send the chunk
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "text_chunk",
                            "content": response.text,
                            "complete": False
                        })
                        # If this is the last chunk, send complete=True
                        if getattr(response, "generation_complete", False) or \
                        (hasattr(response, "server_content") and getattr(response.server_content, "generation_complete", False)):
                            await self._safe_websocket_send(websocket, client_id, {
                                "type": "text_chunk",
                                "content": "",
                                "complete": True
                            })
                    
                    elif getattr(response, "server_content", None):
                        if response.server_content.generation_complete:
                            await self._safe_websocket_send(websocket, client_id, {
                                "type": "generation_complete",
                                "message": "Response generation completed"
                            })
                            # --- Forced reconnect/heartbeat logic removed ---
                            # Only reconnect if go_away or error occurs
                        if response.server_content.interrupted:
                            await self._safe_websocket_send(websocket, client_id, {
                                "type": "interrupted",
                                "message": "Generation was interrupted"
                            })
                    
                    elif hasattr(response, 'tool_call') and response.tool_call:
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "tool_call",
                            "tool_call": str(response.tool_call)
                        })
                    
                    elif getattr(response, "usage_metadata", None):
                        usage = response.usage_metadata
                        # Convert usage details to JSON-serializable format
                        details = []
                        for detail in getattr(usage, 'response_tokens_details', []):
                            modality = getattr(detail, 'modality', 'unknown')
                            # Convert enum to string if it's an enum
                            if hasattr(modality, 'value'):
                                modality = modality.value
                            elif hasattr(modality, 'name'):
                                modality = modality.name
                            else:
                                modality = str(modality)
                            
                            details.append({
                                "modality": modality,
                                "token_count": getattr(detail, 'token_count', 0)
                            })
                        
                        await self._safe_websocket_send(websocket, client_id, {
                            "type": "usage_update",
                            "total_tokens": usage.total_token_count,
                            "details": details
                        })
        except Exception as e:
            logger.error(f"[Gemini] Error listening to Live API for {client_id}: {e}")
            logger.error(f"[Gemini] Exception type: {type(e)}")
            logger.error(f"[Gemini] WebSocket type: {type(websocket)}")
            logger.error(f"[Gemini] Client ID type: {type(client_id)}")
            logger.error(f"[Gemini] Active sessions type: {type(active_sessions)}")
            
            # Try to send error message with extra safety
            error_message = str(e)
            await self._safe_websocket_send(websocket, client_id, {
                "type": "error",
                "message": error_message
            })
