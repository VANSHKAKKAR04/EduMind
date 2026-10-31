import asyncio
import json
import base64
import websockets
import logging
from typing import Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import os
from pydantic import BaseModel
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Gemini Audio Chat Backend")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GeminiLiveClient:
    """Client for connecting to Gemini Live API"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.websocket = None
        self.connected = False
        self.config = None
        
    async def connect(self):
        """Connect to Gemini Live API"""
        try:
            print("🔌 Attempting to connect to Gemini Live API...")
            # Gemini Live API WebSocket URL
            url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            print(f"🌐 Connecting to URL: {url}")
            print(f"🔑 Using API key: {self.api_key[:10]}...")
            
            self.websocket = await websockets.connect(url, additional_headers=headers)
            self.connected = True
            print("✅ Successfully connected to Gemini Live API")
            logger.info("Connected to Gemini Live API")
            
        except Exception as e:
            print(f"❌ Failed to connect to Gemini Live API: {e}")
            logger.error(f"Failed to connect to Gemini Live API: {e}")
            raise
    
    async def send_setup(self, config: Dict[str, Any]):
        """Send setup configuration to Gemini"""
        if not self.connected or not self.websocket:
            raise Exception("Not connected to Gemini Live API")
        
        print("📤 Sending setup configuration to Gemini...")
        print(f"🛠️ Config: {json.dumps(config, indent=2)}")
        
        self.config = config
        
        # Fixed setup message structure based on official documentation
        setup_message = {
            "setup": {
                "model": config.get("model", "models/gemini-2.5-flash-native-audio-preview-12-2025"),
                "generationConfig": {  # Fixed: was "generation_config"
                    "responseModalities": config.get("response_modalities", ["AUDIO", "TEXT"]),  # Fixed: was "response_modalities"
                    "speechConfig": {  # Fixed: was "speech_config"
                        "voiceConfig": {  # Fixed: was "voice_config"
                            "prebuiltVoiceConfig": {  # Fixed: was "prebuilt_voice_config"
                                "voiceName": config.get("voice_name", "Puck")  # Fixed: was "voice_name"
                            }
                        }
                    }
                },
                "systemInstruction": {  # Fixed: was "system_instruction"
                    "parts": [{ "text": "You are a helpful assistant." }]
                },
                "tools": []
            }
        }
        
        print(f"📋 Setup message: {json.dumps(setup_message, indent=2)}")
        await self.websocket.send(json.dumps(setup_message))
        print("✅ Setup configuration sent successfully")
        logger.info("Sent setup configuration to Gemini")
    
    async def send_audio(self, audio_data: str):
        """Send audio data to Gemini using realtime input"""
        if not self.connected or not self.websocket:
            raise Exception("Not connected to Gemini Live API")
        
        print(f"🎵 Sending audio data to Gemini, size: {len(audio_data)} chars")
        
        # Fixed: Using realtimeInput instead of realtime_input
        # Audio format should be PCM 16kHz for input
        message = {
            "realtimeInput": {
                "mediaChunks": [
                    {
                        "mimeType": "audio/pcm;rate=16000",  # Fixed: should be PCM for input
                        "data": audio_data
                    }
                ]
            }
        }
        
        print(f"📤 Audio message structure: {json.dumps({k: v if k != 'data' else f'[{len(v)} chars]' for k, v in message['realtimeInput']['mediaChunks'][0].items()}, indent=2)}")
        await self.websocket.send(json.dumps(message))
        print("✅ Audio data sent successfully")
        logger.info("Sent audio data to Gemini")
    
    async def send_text(self, text: str):
        """Send text input to Gemini using clientContent"""
        if not self.connected or not self.websocket:
            raise Exception("Not connected to Gemini Live API")
        
        print(f"📝 Sending text to Gemini: '{text}'")
        
        # Fixed: Using clientContent for text messages
        message = {
            "clientContent": {
                "turns": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": text
                            }
                        ]
                    }
                ],
                "turnComplete": True
            }
        }
        
        print(f"📤 Text message sent")
        await self.websocket.send(json.dumps(message))
        logger.info(f"Sent text to Gemini: {text}")
    
    async def receive_message(self):
        """Receive message from Gemini"""
        if not self.connected or not self.websocket:
            return None
        
        try:
            message = await self.websocket.recv()
            return json.loads(message)
        except websockets.exceptions.ConnectionClosed:
            self.connected = False
            logger.info("Gemini WebSocket connection closed")
            return None
        except Exception as e:
            logger.error(f"Error receiving message from Gemini: {e}")
            return None
    
    async def close(self):
        """Close connection to Gemini"""
        if self.websocket:
            await self.websocket.close()
        self.connected = False
        logger.info("Disconnected from Gemini Live API")

class ConnectionManager:
    """Manages WebSocket connections"""
    
    def __init__(self):
        self.active_connections: Dict[WebSocket, GeminiLiveClient] = {}
    
    async def connect(self, websocket: WebSocket, api_key: str):
        """Accept WebSocket connection and connect to Gemini"""
        await websocket.accept()
        
        # Create Gemini client
        gemini_client = GeminiLiveClient(api_key)
        await gemini_client.connect()
        
        self.active_connections[websocket] = gemini_client
        
        # Start listening to Gemini responses
        asyncio.create_task(self.listen_to_gemini(websocket, gemini_client))
        
        logger.info("Client connected")
    
    async def disconnect(self, websocket: WebSocket):
        """Disconnect WebSocket and close Gemini connection"""
        if websocket in self.active_connections:
            gemini_client = self.active_connections[websocket]
            await gemini_client.close()
            del self.active_connections[websocket]
        
        logger.info("Client disconnected")
    
    async def send_message(self, websocket: WebSocket, message: dict):
        """Send message to WebSocket client"""
        try:
            print(f"➡️ Sending to client: {json.dumps(message, indent=2)}")  # <-- Add this line
            await websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"Error sending message to client: {e}")
    
    async def listen_to_gemini(self, websocket: WebSocket, gemini_client: GeminiLiveClient):
        """Listen to Gemini responses and forward to client"""
        while gemini_client.connected:
            try:
                message = await gemini_client.receive_message()
                if message is None:
                    break
                
                print(f"📥 Received from Gemini: {json.dumps(message, indent=2)}")
                
                # Process different types of messages from Gemini
                await self.process_gemini_message(websocket, message)
                
            except Exception as e:
                logger.error(f"Error in Gemini listener: {e}")
                break
    
    async def process_gemini_message(self, websocket: WebSocket, message: dict):
        """Process messages from Gemini and send appropriate response to client"""
        try:
            # Handle setup acknowledgment
            if "setupComplete" in message:
                await self.send_message(websocket, {
                    "type": "info",
                    "message": "Gemini setup complete"
                })
            
            # Handle server content (audio/text responses)
            elif "serverContent" in message:
                content = message["serverContent"]
                
                if "modelTurn" in content:
                    parts = content["modelTurn"].get("parts", [])
                    
                    for part in parts:
                        # Handle audio response
                        if "inlineData" in part:
                            inline_data = part["inlineData"]
                            # Output audio from Gemini is PCM 24kHz
                            mime_type = inline_data.get("mimeType", "audio/pcm")
                            print("🔊 Sending Gemini audio to client")
                            await self.send_message(websocket, {
                                    "type": "audio",
                                    "audio_data": inline_data.get("data", ""),
                                    "mime_type": mime_type
                                })
                        
                        # Handle text response
                        elif "text" in part:
                            print("💬 Sending Gemini transcript to client")
                            await self.send_message(websocket, {
                                "type": "transcript",
                                "text": part["text"]
                            })
            
            # Handle tool calls
            elif "toolCall" in message:
                tool_call = message["toolCall"]
                await self.send_message(websocket, {
                    "type": "info",
                    "message": f"Tool call: {tool_call}"
                })
            
            # Handle interruption
            elif "interrupted" in message:
                await self.send_message(websocket, {
                    "type": "info",
                    "message": "Conversation interrupted"
                })
            
            # Handle user transcription
            elif "realtimeInput" in message:
                realtime_input = message["realtimeInput"]
                if "userTranscript" in realtime_input:
                    print("📝 Sending user transcript to client")
                    print(f"📝 User transcript: {realtime_input['userTranscript']}")  # <-- Add this line
                    await self.send_message(websocket, {
                        "type": "user_transcript",
                        "text": realtime_input["userTranscript"]
                    })
            
            # Handle errors
            elif "error" in message:
                error = message["error"]
                await self.send_message(websocket, {
                    "type": "error",
                    "message": f"Gemini error: {error.get('message', 'Unknown error')}"
                })
            
            # Handle GoAway messages (session ending)
            elif "goAway" in message:
                go_away = message["goAway"]
                await self.send_message(websocket, {
                    "type": "info",
                    "message": f"Session ending in {go_away.get('timeLeft', 'unknown')} seconds"
                })
            
            # Log unknown message types
            else:
                logger.info(f"Unknown message type from Gemini: {message}")
                
        except Exception as e:
            logger.error(f"Error processing Gemini message: {e}")
            await self.send_message(websocket, {
                "type": "error",
                "message": f"Error processing response: {str(e)}"
            })

# Global connection manager
manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for client connections"""
    
    # Get API key from environment or query parameter
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        await websocket.close(code=1008, reason="GEMINI_API_KEY not found")
        return
    
    try:
        await manager.connect(websocket, api_key)
        
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Get Gemini client for this connection
            gemini_client = manager.active_connections.get(websocket)
            if not gemini_client:
                await websocket.close(code=1008, reason="Gemini client not found")
                break
            
            # Process different message types
            if message["type"] == "setup":
                config = message.get("config", {})
                await gemini_client.send_setup(config)
                
            elif message["type"] == "audio_input":
                audio_data = message.get("audio_data", "")
                if audio_data:
                    await gemini_client.send_audio(audio_data)
                    
            elif message["type"] == "text_input":
                text = message.get("text", "")
                if text:
                    await gemini_client.send_text(text)
            
            else:
                logger.warning(f"Unknown message type: {message['type']}")
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await manager.disconnect(websocket)

@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Gemini Audio Chat Backend is running"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

if __name__ == "__main__":
    # Check for required environment variables
    if not os.getenv("GEMINI_API_KEY"):
        logger.error("GEMINI_API_KEY environment variable is required")
        exit(1)
    
    # Run the FastAPI app
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
