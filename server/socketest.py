import asyncio
import base64
import json
import logging
import os
from datetime import datetime
from typing import Dict, Any, Optional
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai
from google.generativeai import types
import websockets
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Mental Health Chatbot API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Configure Gemini


class ConnectionManager:
    """Manages WebSocket connections and Gemini Live API sessions"""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.gemini_sessions: Dict[str, Any] = {}
        self.audio_buffers: Dict[str, list] = {}
        self.session_states: Dict[str, str] = {}  # 'listening', 'processing', 'speaking'
    
    async def connect(self, websocket: WebSocket, client_id: str):
        """Accept WebSocket connection and initialize Gemini session"""
        await websocket.accept()
        self.active_connections[client_id] = websocket
        self.audio_buffers[client_id] = []
        self.session_states[client_id] = 'idle'
        
        # Initialize Gemini Live session
        await self._initialize_gemini_session(client_id)
        
        logger.info(f"Client {client_id} connected")
    
    async def disconnect(self, client_id: str):
        """Clean up connection and Gemini session"""
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        
        if client_id in self.gemini_sessions:
            try:
                await self.gemini_sessions[client_id].close()
                del self.gemini_sessions[client_id]
            except Exception as e:
                logger.error(f"Error closing Gemini session for {client_id}: {e}")
        
        if client_id in self.audio_buffers:
            del self.audio_buffers[client_id]
        
        if client_id in self.session_states:
            del self.session_states[client_id]
        
        logger.info(f"Client {client_id} disconnected")
    
    async def _initialize_gemini_session(self, client_id: str):
        """Initialize Gemini Live API session"""
        try:
            # Mental health system prompt
            system_prompt = """You are a compassionate mental health support chatbot. Your role is to:

1. Provide empathetic, non-judgmental support to users discussing mental health concerns
2. Listen actively and validate the user's feelings and experiences
3. Offer coping strategies, mindfulness techniques, and general wellness advice
4. Encourage professional help when appropriate, especially for crisis situations
5. Maintain boundaries - you are a support tool, not a replacement for professional therapy
6. Keep responses concise but warm, suitable for spoken conversation
7. If someone expresses suicidal thoughts or immediate danger, encourage them to contact emergency services or crisis hotlines

Important guidelines:
- Always be compassionate and understanding
- Avoid giving specific medical or psychiatric advice
- Focus on emotional support and general wellness strategies
- Keep responses conversational and natural for voice interaction
- If you detect a crisis situation, prioritize safety resources

Remember: You're having a voice conversation, so keep responses natural and spoken-word friendly."""

            # Configure the model for mental health support
            from core.config import settings
            client = genai.Client(api_key=settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY"))

        # Configure for live audio interaction
            config = types.LiveConnectConfig(
            response_modalities=["AUDIO", "TEXT"],
            speech_config={
                "voice_config": {
                    "prebuilt_voice_config": {
                        "voice_name": "Aoede"
                    }
                }
            },
            system_instruction=system_prompt
        )
            
            # Start live session
            session_cm = client.aio.live.connect(model="gemini-2.0-flash-exp", config=config)
            session = await session_cm.__aenter__()
            self.gemini_sessions[client_id] = session

        # Start listening for responses from Gemini
            asyncio.create_task(self._handle_gemini_responses(client_id, session))

            logger.info(f"Gemini session initialized for client {client_id}")

        except Exception as e:
            logger.error(f"Failed to initialize Gemini session for {client_id}: {e}")
            await self._send_error(client_id, f"Failed to initialize AI session: {str(e)}")
    
    async def _handle_gemini_responses(self, client_id: str, live_session):
        """Handle responses from Gemini Live API"""
        try:
            async for response in live_session.receive():
                if client_id not in self.active_connections:
                    break
                
                if response.server_content:
                    if response.server_content.model_turn:
                        # Handle text response
                        for part in response.server_content.model_turn.parts:
                            if hasattr(part, 'text') and part.text:
                                await self._send_message(client_id, {
                                    "type": "text_response",
                                    "content": part.text,
                                    "timestamp": datetime.now().isoformat()
                                })
                    
                    if response.server_content.turn_complete:
                        # Turn is complete, ready for next user input
                        self.session_states[client_id] = 'listening'
                
                # Handle audio data
                if hasattr(response, 'audio_data') and response.audio_data:
                    await self._send_message(client_id, {
                        "type": "audio_response",
                        "content": base64.b64encode(response.audio_data).decode('utf-8'),
                        "timestamp": datetime.now().isoformat()
                    })
                
        except Exception as e:
            logger.error(f"Error handling Gemini responses for {client_id}: {e}")
            await self._send_error(client_id, f"AI session error: {str(e)}")
    
    async def send_audio_chunk(self, client_id: str, audio_data: bytes):
        """Send audio chunk to Gemini"""
        try:
            if client_id in self.gemini_sessions:
                live_session = self.gemini_sessions[client_id]
                await live_session.send(audio_data, mime_type="audio/webm")
                
        except Exception as e:
            logger.error(f"Error sending audio to Gemini for {client_id}: {e}")
            await self._send_error(client_id, f"Error processing audio: {str(e)}")
    
    async def start_recording(self, client_id: str):
        """Signal start of user recording"""
        self.session_states[client_id] = 'listening'
        self.audio_buffers[client_id] = []
        logger.info(f"Started recording for client {client_id}")
    
    async def stop_recording(self, client_id: str):
        """Signal end of user recording and process accumulated audio"""
        try:
            if client_id in self.gemini_sessions and self.audio_buffers[client_id]:
                self.session_states[client_id] = 'processing'
                
                # Combine all audio chunks
                combined_audio = b''.join(self.audio_buffers[client_id])
                
                if combined_audio:
                    # Send the complete audio to Gemini
                    live_session = self.gemini_sessions[client_id]
                    await live_session.send(combined_audio, mime_type="audio/webm")
                    
                    # Clear the buffer
                    self.audio_buffers[client_id] = []
                    
                    logger.info(f"Sent complete audio to Gemini for client {client_id}")
                
        except Exception as e:
            logger.error(f"Error processing complete audio for {client_id}: {e}")
            await self._send_error(client_id, f"Error processing your message: {str(e)}")
    
    async def _send_message(self, client_id: str, message: dict):
        """Send message to WebSocket client"""
        if client_id in self.active_connections:
            try:
                await self.active_connections[client_id].send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Error sending message to {client_id}: {e}")
    
    async def _send_error(self, client_id: str, error_message: str):
        """Send error message to WebSocket client"""
        await self._send_message(client_id, {
            "type": "error",
            "message": error_message,
            "timestamp": datetime.now().isoformat()
        })

# Initialize connection manager
manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Main WebSocket endpoint for real-time communication"""
    client_id = str(uuid.uuid4())
    
    try:
        await manager.connect(websocket, client_id)
        
        # Send welcome message
        await manager._send_message(client_id, {
            "type": "system",
            "message": "Connected to mental health support. I'm here to listen and help.",
            "timestamp": datetime.now().isoformat()
        })
        
        while True:
            try:
                # Receive message from client
                data = await websocket.receive_text()
                message = json.loads(data)
                
                message_type = message.get("type")
                
                if message_type == "audio_chunk":
                    # Decode base64 audio data
                    audio_data = base64.b64decode(message.get("data", ""))
                    
                    # Buffer the audio chunk
                    if client_id in manager.audio_buffers:
                        manager.audio_buffers[client_id].append(audio_data)
                    
                    # Send real-time audio chunk to Gemini
                    await manager.send_audio_chunk(client_id, audio_data)
                
                elif message_type == "start_recording":
                    await manager.start_recording(client_id)
                
                elif message_type == "stop_recording":
                    await manager.stop_recording(client_id)
                
                elif message_type == "text_message":
                    # Handle text input (fallback)
                    text_content = message.get("content", "")
                    if text_content and client_id in manager.gemini_sessions:
                        live_session = manager.gemini_sessions[client_id]
                        await live_session.send(text_content)
                
                else:
                    logger.warning(f"Unknown message type: {message_type}")
                    
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON received from client {client_id}")
                await manager._send_error(client_id, "Invalid message format")
                
            except Exception as e:
                logger.error(f"Error processing message from {client_id}: {e}")
                await manager._send_error(client_id, "Error processing your message")
                
    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for client {client_id}: {e}")
    finally:
        await manager.disconnect(client_id)

# Health check endpoints
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "active_connections": len(manager.active_connections)
    }

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Mental Health Chatbot API",
        "version": "1.0.0",
        "endpoints": {
            "websocket": "/ws",
            "health": "/health"
        },
        "features": [
            "Real-time audio streaming",
            "Google Gemini Live API integration",
            "Mental health support conversations",
            "Voice activity detection support"
        ]
    }

# Crisis resources endpoint
@app.get("/crisis-resources")
async def get_crisis_resources():
    """Get crisis support resources"""
    return {
        "emergency": {
            "us": "988 (Suicide & Crisis Lifeline)",
            "international": "Visit findahelpline.com"
        },
        "text_support": {
            "crisis_text_line": "Text HOME to 741741",
            "description": "Free, 24/7 crisis support via text"
        },
        "online_resources": [
            {
                "name": "National Suicide Prevention Lifeline",
                "url": "https://suicidepreventionlifeline.org",
                "description": "Free and confidential emotional support"
            },
            {
                "name": "Crisis Text Line",
                "url": "https://crisistextline.org",
                "description": "Free crisis support via text message"
            },
            {
                "name": "NAMI (National Alliance on Mental Illness)",
                "url": "https://nami.org",
                "description": "Mental health education, support and advocacy"
            }
        ],
        "disclaimer": "This chatbot is a support tool, not a replacement for professional mental health care."
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )