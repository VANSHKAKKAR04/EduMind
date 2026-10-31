import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Volume2, VolumeX, Phone, PhoneOff } from "lucide-react";
import { Modal, Button, Alert ,notification} from "antd";

const GeminiAudioChatModal = ({
  visible,
  onClose,
  userProfile,
  conversationHistory,
  sessionId,
  onAudioChatClose,
}) => {
  const [isCalling, setIsCalling] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [logs, setLogs] = useState([]);
  const [audioQueueLength, setAudioQueueLength] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [emotionDetectionEnabled, setEmotionDetectionEnabled] = useState(false);
  const [cameraPermission, setCameraPermission] = useState(null);
  const [emotionWs, setEmotionWs] = useState(null);
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [distress, setDistress] = useState(0);
  const [log, setLog] = useState("");
  
  // Refs for audio management
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const streamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimeoutRef = useRef(null);
  const audioContextReadyRef = useRef(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });

  // Enhanced audio system refs
  const audioBufferRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef(null);
  const nextSourceRef = useRef(null);
  const audioSchedulerRef = useRef(null);
  const playbackStartTimeRef = useRef(0);
  const bufferDurationRef = useRef(0);
  const crossfadeGainRef = useRef(null);
  const masterGainRef = useRef(null);

  // Transcript accumulators
  const currentInputTranscriptRef = useRef("");
  const currentOutputTranscriptRef = useRef("");
  const NODE_BACKEND_URL = "http://localhost:4000";
  // Audio configuration
  // Adjusted for faster response and reliability
  const AUDIO_CONFIG = {
    sampleRate: 24000,
    bufferSize: 12288,
    minBufferChunks: 3, // Lower for faster start
    maxBufferChunks: 20,
    crossfadeDuration: 0.025, // Shorter crossfade for snappier response
    lookAheadTime: 0.02,
    targetLatency: 0.02,
    underrunPause: 60, // ms to wait if underrun
    fadeInDuration: 0.005, // 5ms fade in
    fadeOutDuration: 0.005, // 5ms fade out
    chunkTimeout: 3000, // ms to wait before skipping stuck chunk
  };
  const addLog = useCallback((message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-50), { timestamp, message, type }]);
  }, []);

  // Enhanced audio context initialization
  const initializeAudioContext = async () => {
    if (
      audioContextReadyRef.current &&
      audioContextRef.current?.state !== "closed"
    ) {
      return;
    }
    try {
      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: AUDIO_CONFIG.sampleRate,
        latencyHint: "interactive",
      });

      // Create master gain node for volume control
      masterGainRef.current = audioContextRef.current.createGain();
      masterGainRef.current.connect(audioContextRef.current.destination);

      // Create crossfade gain node for smooth transitions
      crossfadeGainRef.current = audioContextRef.current.createGain();
      crossfadeGainRef.current.connect(masterGainRef.current);

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      audioContextReadyRef.current = true;
      addLog(
        `Enhanced audio context ready (${audioContextRef.current.sampleRate}Hz)`,
        "success"
      );
    } catch (error) {
      addLog(`Audio context error: ${error.message}`, "error");
    }
  };

  const isPCMFormat = (mimeType) => {
    return (
      mimeType && (mimeType.startsWith("audio/pcm") || mimeType.includes("pcm"))
    );
  };

  // Simplified audio buffer creation with detailed logging
  const createAudioBuffer = async (audioData, mimeType) => {
    if (!audioContextRef.current) {
      addLog("Audio context not initialized", "error");
      return null;
    }
    let audioBuffer;
    try {
      if (isPCMFormat(mimeType)) {
        const binaryString = atob(audioData);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
        if (uint8Array.length % 2 !== 0) {
          addLog("PCM data length is not even, possible corruption", "error");
          return null;
        }
        const int16Array = new Int16Array(uint8Array.buffer);
        addLog(
          "PCM first 10 samples: " +
            Array.from(int16Array.slice(0, 10)).join(", "),
          "info"
        );
        addLog(
          `PCM chunk length: ${int16Array.length}, expected sampleRate: ${AUDIO_CONFIG.sampleRate}`,
          "info"
        );
        audioBuffer = audioContextRef.current.createBuffer(
          1,
          int16Array.length,
          AUDIO_CONFIG.sampleRate
        );
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16Array.length; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }
      } else {
        const binaryString = atob(audioData);
        const arrayBuffer = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          arrayBuffer[i] = binaryString.charCodeAt(i);
        }
        audioBuffer = await audioContextRef.current.decodeAudioData(
          arrayBuffer.buffer
        );
      }
      addLog(
        `AudioBuffer created: duration=${audioBuffer.duration.toFixed(
          3
        )}s, sampleRate=${audioBuffer.sampleRate}, length=${
          audioBuffer.length
        }`,
        "info"
      );
      return audioBuffer;
    } catch (err) {
      addLog("createAudioBuffer error: " + err.message, "error");
      return null;
    }
  };

  // Simplified audio playback with crossfade and lookahead scheduling
  const processAudioQueue = async () => {
    if (isPlayingRef.current) return;
    if (audioBufferRef.current.length === 0) return;
    // Underrun protection: wait for enough buffer before starting
    if (!isPlaying && audioBufferRef.current.length < AUDIO_CONFIG.minBufferChunks) {
      setTimeout(processAudioQueue, AUDIO_CONFIG.underrunPause);
      return;
    }
    try {
      isPlayingRef.current = true;
      setIsPlaying(true);
      const chunk = audioBufferRef.current.shift();
      setAudioQueueLength(audioBufferRef.current.length);
      addLog(
        `Dequeued audio chunk. Remaining queue: ${audioBufferRef.current.length}`,
        "info"
      );
      const audioBuffer = await createAudioBuffer(chunk.data, chunk.mimeType);
      if (!audioBuffer) {
        addLog("Failed to create audio buffer, skipping chunk", "error");
        isPlayingRef.current = false;
        setIsPlaying(false);
        if (audioBufferRef.current.length > 0)
          setTimeout(processAudioQueue, 100);
        return;
      }
      // Stop previous source if still playing
      if (currentSourceRef.current) {
        try {
          currentSourceRef.current.stop();
        } catch (e) {}
        currentSourceRef.current = null;
      }
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      // Use crossfade gain for smooth transitions
      source.connect(crossfadeGainRef.current);
      // Fade-in and fade-out to avoid clicks
      const now = audioContextRef.current.currentTime;
      let startTime = now;
      if (playbackStartTimeRef.current > now) {
        startTime = playbackStartTimeRef.current;
      }
      // Fade-in
      crossfadeGainRef.current.gain.cancelScheduledValues(startTime);
      crossfadeGainRef.current.gain.setValueAtTime(0, startTime);
      crossfadeGainRef.current.gain.linearRampToValueAtTime(
        1,
        startTime + AUDIO_CONFIG.fadeInDuration
      );
      // Fade-out
      crossfadeGainRef.current.gain.setValueAtTime(1, startTime + audioBuffer.duration - AUDIO_CONFIG.fadeOutDuration);
      crossfadeGainRef.current.gain.linearRampToValueAtTime(
        0,
        startTime + audioBuffer.duration
      );
      // Watchdog: skip chunk if it doesn't end in time
      let chunkTimeout = setTimeout(() => {
        addLog("Audio chunk timeout, skipping to next.", "warning");
        try { source.stop(); } catch (e) {}
        isPlayingRef.current = false;
        setIsPlaying(false);
        if (audioBufferRef.current.length > 0) processAudioQueue();
      }, AUDIO_CONFIG.chunkTimeout);
      // Crossfade out for next chunk
      source.onended = () => {
        clearTimeout(chunkTimeout);
        addLog("Audio chunk playback ended", "info");
        isPlayingRef.current = false;
        setIsPlaying(false);
        setAudioQueueLength(audioBufferRef.current.length);
        if (audioBufferRef.current.length > 0) processAudioQueue();
      };
      currentSourceRef.current = source;
      addLog(
        `Starting playback: duration=${audioBuffer.duration.toFixed(
          3
        )}s (crossfade)`,
        "success"
      );
      source.start(startTime);
      // Schedule next chunk slightly before this one ends (lookahead)
      playbackStartTimeRef.current =
        startTime + audioBuffer.duration - AUDIO_CONFIG.crossfadeDuration;
      if (audioBufferRef.current.length > 0) {
        setTimeout(
          processAudioQueue,
          (audioBuffer.duration - AUDIO_CONFIG.crossfadeDuration) * 1000
        );
      }
    } catch (error) {
      addLog("Audio processing/playback error: " + error.message, "error");
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (audioBufferRef.current.length > 0) setTimeout(processAudioQueue, 100);
    }
  };

  // Store last detected emotion for playback
  const lastEmotionRef = useRef("");

  // Synthesize a short TTS tag for emotion (optional, can be toggled)
  const synthesizeEmotionTag = async (emotionText) => {
    if (!emotionText) return null;
    try {
      const ttsPCM = await synthesizeEmotionPCM(`You sound ${emotionText}`);
      if (ttsPCM && ttsPCM.length > 0 && !isNaN(ttsPCM[0])) {
        return convertPCMToBase64(ttsPCM);
      }
    } catch (err) {
      addLog("Emotion TTS error: " + err.message, "error");
    }
    return null;
  };

  // Enhanced audio queueing with emotion support
  const queueAudio = async (audioData, mimeType, emotionTag) => {
    if (!audioData || isMuted) return;
    // If emotionTag is present and different from last, synthesize and queue TTS
    if (emotionTag && emotionTag !== lastEmotionRef.current) {
      lastEmotionRef.current = emotionTag;
      setEmotion((prev) => ({ ...prev, playback: emotionTag }));
      addLog(`Emotion detected in audio: ${emotionTag}`, "ai-response");
      // Optionally synthesize and queue TTS tag
      const ttsBase64 = await synthesizeEmotionTag(emotionTag);
      if (ttsBase64) {
        audioBufferRef.current.push({
          data: ttsBase64,
          mimeType: "audio/pcm",
          timestamp: Date.now(),
          isEmotionTag: true,
          emotion: emotionTag,
        });
      }
    }
    audioBufferRef.current.push({
      data: audioData,
      mimeType: mimeType || "audio/pcm",
      timestamp: Date.now(),
      emotion: emotionTag || lastEmotionRef.current,
    });
    setAudioQueueLength(audioBufferRef.current.length);
    processAudioQueue();
  };

  // Enhanced audio stopping with fade-out
  const stopCurrentAudio = () => {
    if (currentSourceRef.current) {
      try {
        // Fade out quickly to avoid clicks
        const currentTime = audioContextRef.current.currentTime;
        const fadeOutDuration = 0.01; // 10ms fade out

        if (crossfadeGainRef.current) {
          crossfadeGainRef.current.gain.cancelScheduledValues(currentTime);
          crossfadeGainRef.current.gain.setValueAtTime(
            crossfadeGainRef.current.gain.value,
            currentTime
          );
          crossfadeGainRef.current.gain.linearRampToValueAtTime(
            0,
            currentTime + fadeOutDuration
          );
        }

        setTimeout(() => {
          if (currentSourceRef.current) {
            currentSourceRef.current.stop();
            currentSourceRef.current = null;
          }
        }, fadeOutDuration * 1000);
      } catch (error) {
        // Ignore stop errors
      }
    }

    isPlayingRef.current = false;
    setIsPlaying(false);
  };

  const clearAudioQueue = () => {
    audioBufferRef.current = [];
    stopCurrentAudio();
    setAudioQueueLength(0);
    addLog("Audio queue cleared", "info");
  };

  // Enhanced connection with better error handling
  const connectToBackend = async () => {
    setIsCalling(true);
    setLog("");
    setConnectionStatus("connecting");
    if (!userProfile || Object.keys(userProfile).length === 0) {
      setLog("User profile is missing or empty. Cannot start audio call.");
      setConnectionStatus("error");
      setIsCalling(false);
      console.warn(
        "GeminiAudioChatModal: userProfile is missing or empty",
        userProfile
      );
      return;
    }
    if (!conversationHistory) {
      setLog(
        "Conversation history is missing or empty. Cannot start audio call."
      );
      setConnectionStatus("error");
      setIsCalling(false);
      console.warn(
        "GeminiAudioChatModal: conversationHistory is missing or empty",
        conversationHistory
      );
      return;
    }
    try {
      wsRef.current = new window.WebSocket("ws://localhost:8000/audio");
      wsRef.current.onopen = () => {
        setConnectionStatus("connected");
        setLog("Connected to audio backend. Sending setup...");
        wsRef.current.send(
          JSON.stringify({
            type: "setup",
            config: {
              model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
              response_modalities: ["AUDIO"],
              voice_name:"Puck",
              systemContext: {
                user_profile: userProfile,
                conversation_history: conversationHistory,
              },
              // VAD config removed: let Gemini handle VAD with defaults
            },
          })
        );
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "setup_complete":
              setLog("Audio session setup complete. You can now talk!");
            case "audio":
              if (data.audio_data && !isMuted) {
                // Pass emotion if present
                queueAudio(
                  data.audio_data,
                  data.mime_type || "audio/pcm",
                  data.emotion
                );
              }
              break;

            case "input_transcription":
              currentInputTranscriptRef.current += data.text || "";
              break;

            case "output_transcription":
              currentOutputTranscriptRef.current += data.text || "";
              break;

            case "turnComplete":
              console.log("Turn   Completed");
              const currentEmotion = emotionDetectionEnabled ? emotion.aggregated || "" : "";
              (async () => {
                if (currentInputTranscriptRef.current) {
                  setInputTranscript(currentInputTranscriptRef.current);
                  // Await distress score before saving message
                  const distressScore = await analyzeDistressScore(currentInputTranscriptRef.current);
                  const savedEmotion = recordingEmotionRef.current;
                  console.log(savedEmotion);
                  // Log emotion and distress before saving
                  console.log("[saveMessage] User Emotion:", savedEmotion);
                  console.log("[saveMessage] User Distress:", distressScore);
                  addLog(`[saveMessage] User Emotion: ${savedEmotion}` , "info");
                  addLog(`[saveMessage] User Distress: ${distressScore}` , "info");
                  const inputDict={
                    sender: "user",
                    type: "user",
                    text: currentInputTranscriptRef.current,
                    emotion: savedEmotion,
                    distressScore: distressScore,
                    timestamp: new Date().toISOString(),
                  };
                  const saveResult = await saveMessage(sessionId, inputDict);
                  if (Array.isArray(conversationHistory)) {
                    conversationHistory.push(inputDict);
                  }
                  if (saveResult) {
                    addLog("User message saved successfully", "success");
                  }
                  currentInputTranscriptRef.current = "";
                }
                if (currentOutputTranscriptRef.current) {
                  setOutputTranscript(currentOutputTranscriptRef.current);
                  console.log("output:", outputTranscript);
                  addLog(
                    `[saveMessage] Model Output: ${outputTranscript}`,
                    "info"
                  );
                  const outputDict={
                    sender: "bot",
                    type: "model",
                    text: currentOutputTranscriptRef.current,
                    timestamp: new Date().toISOString(),
                  };
                  if (Array.isArray(conversationHistory)) {
                    conversationHistory.push(outputDict);
                  }
                  const saveResult = await saveMessage(sessionId, outputDict);
                  if (saveResult) {
                    addLog("Model message saved successfully", "success");
                  }
                  currentOutputTranscriptRef.current = "";
                }
                addLog("Turn completed", "success");
              })();
              break;

            case "error":
              addLog(`Error: ${data.message}`, "error");
              break;

            default:
              console.log("[unhandled message type]", data);
              break;
          }
        } catch (error) {
          addLog(`Message parsing error: ${error.message}`, "error");
        }
      };

      wsRef.current.onerror = (error) => {
        addLog("WebSocket error", "error");
        setConnectionStatus("error");
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setConnectionStatus("disconnected");
        addLog(
          `Disconnected: ${event.reason || "Connection closed"}`,
          "warning"
        );
        clearAudioQueue();
      };
    } catch (error) {
      addLog(`Connection error: ${error.message}`, "error");
      setConnectionStatus("error");
    }
  };
  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  // Fixed saveMessage function
  const saveMessage = async (sessionId, message) => {
    try {
      console.log("[saveMessage] Attempting to save:", message);
      console.log("[saveMessage] Session ID:", sessionId);

      const response = await fetch(
        `${NODE_BACKEND_URL}/api/chat/sessions/${sessionId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify(message),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[saveMessage] Backend responded with status ${response.status}:`,
          errorText
        );
        addLog(
          `Failed to save message: ${response.status} - ${errorText}`,
          "error"
        );
        return false;
      }

      const result = await response.json();
      console.log("[saveMessage] Successfully saved:", result);
      addLog("Message saved successfully", "success");
      return true;
    } catch (err) {
      console.error("[saveMessage] Network/parsing error:", err);
      addLog(`Save message error: ${err.message}`, "error");
      return false;
    }
  };
  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    if (isRecording) {
      stopRecording();
    }

    clearAudioQueue();
  };

  // Enhanced recording with better audio processing
  const startRecording = async () => {
    currentInputTranscriptRef.current = "";
    currentOutputTranscriptRef.current = "";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          latency: 0.01, // Low latency
        },
      });

      streamRef.current = stream;

      const inputAudioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 16000,
        latencyHint: "interactive",
      });

      const source = inputAudioContext.createMediaStreamSource(stream);
      const processor = inputAudioContext.createScriptProcessor(2048, 1, 1); // Smaller buffer for lower latency

      audioChunksRef.current = [];

      processor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        audioChunksRef.current.push(new Float32Array(channelData));
      };

      source.connect(processor);
      processor.connect(inputAudioContext.destination);

      audioProcessorRef.current = {
        context: inputAudioContext,
        processor: processor,
        source: source,
      };

      setIsRecording(true);
      addLog("Recording started (16kHz, low latency)", "success");

      // Auto-stop after 5 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        if (isRecording) {
          stopRecording();
        }
      }, 5000);
    } catch (error) {
      addLog(`Recording error: ${error.message}`, "error");
    }
  };

  // Rest of the emotion detection logic remains the same...
  useEffect(() => {
    if (!emotionDetectionEnabled) return;
    let ws;
    let interval;
    let stream;
    let isMounted = true;

    // Open a dedicated WebSocket for emotion detection
    ws = new WebSocket("ws://localhost:8000");

    ws.onopen = () => {
      console.log("[Emotion] WebSocket connected");
      ws.send(JSON.stringify({ setup: {} }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.emotion) {
        setEmotion(data.emotion);
        // console.log("[Emotion] Current:", data.emotion.current, "Aggregated:", data.emotion.aggregated);
      } else if (data.setupComplete) {
        console.log("[Emotion] Setup complete");
      } else {
        console.warn("[Emotion] Unknown message:", data);
      }
    };

    ws.onerror = (err) => console.error("[Emotion] WebSocket error:", err);
    ws.onclose = () => console.warn("[Emotion] WebSocket closed");

    // Start webcam
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((mediaStream) => {
        stream = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        interval = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log("WebSocket not open");
            return;
          }
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (!canvas) {
            console.log("Canvas not available");
            return;
          }
          if (!video) {
            console.log("Video not available");
            return;
          }
          if (canvas && video) {
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg");
            const base64 = dataURL.split(",")[1];
            // console.log("Frame sent")
            ws.send(JSON.stringify({ frame: base64 }));
          }
        }, 1000);
      })
      .catch((err) => console.error("[Emotion] Error accessing webcam:", err));

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
      if (ws) ws.close();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [emotionDetectionEnabled]);

  const synthesizeEmotionPCM = async (emotionText) => {
    return new Promise((resolve, reject) => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const utter = new window.SpeechSynthesisUtterance(emotionText);
        utter.lang = "en-US";
        // Try to select a more human-like voice
        const voices = window.speechSynthesis.getVoices();
        // Prefer Google or Microsoft neural voices if available
        const preferredVoice = voices.find(v => v.name.toLowerCase().includes("google") || v.name.toLowerCase().includes("microsoft"))
          || voices.find(v => v.lang === "en-US" && v.localService)
          || voices[0];
        if (preferredVoice) {
          utter.voice = preferredVoice;
          console.log("[TTS] Using voice:", preferredVoice.name);
        }
        // Make TTS sound more natural
        utter.pitch = 1.05;
        utter.rate = 0.97;
        utter.volume = 1.0;
        // Create a gain node to capture the audio
        const gainNode = audioCtx.createGain();
        const dest = audioCtx.createMediaStreamDestination();
        gainNode.connect(dest);
        utter.onend = async () => {
          try {
            const recorder = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus" });
            let chunks = [];
            recorder.ondataavailable = (e) => chunks.push(e.data);
            recorder.onstop = async () => {
              const blob = new Blob(chunks, { type: "audio/webm" });
              const arrayBuffer = await blob.arrayBuffer();
              let audioBuffer;
              try {
                audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
              } catch (e) {
                resolve(null);
                return;
              }
              let pcm = audioBuffer.getChannelData(0);
              if (audioBuffer.sampleRate !== 16000) {
                const ratio = audioBuffer.sampleRate / 16000;
                const newLength = Math.floor(pcm.length / ratio);
                const resampled = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                  const idx = i * ratio;
                  const idxLow = Math.floor(idx);
                  const idxHigh = Math.min(Math.ceil(idx), pcm.length - 1);
                  const weight = idx - idxLow;
                  resampled[i] = (1 - weight) * pcm[idxLow] + weight * pcm[idxHigh];
                }
                pcm = resampled;
              }
              const pcm16 = convertTo16BitPCM(pcm);
              resolve(pcm16);
            };
            recorder.start();
            setTimeout(() => recorder.stop(), 1000);
          } catch (err) {
            reject(err);
          }
        };
        window.speechSynthesis.speak(utter);
      } catch (err) {
        reject(err);
      }
    });
  };

  // Convert Float32Array to 16-bit PCM
  const convertTo16BitPCM = (float32Array) => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp values to [-1, 1] and convert to 16-bit
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = sample * 32767; // Convert to 16-bit range
    }
    return int16Array;
  };

  // Convert 16-bit PCM to base64
  const convertPCMToBase64 = (pcmData) => {
    const uint8Array = new Uint8Array(pcmData.buffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  };

  const recordingEmotionRef = useRef("");
  const recordingDistressRef = useRef(0);

  const stopRecording = async () => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.processor.disconnect();
        audioProcessorRef.current.source.disconnect();
        audioProcessorRef.current.context.close();
      } catch (error) {}
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);

    if (audioChunksRef.current.length > 0) {
      let totalSamples = 0;
      audioChunksRef.current.forEach((chunk) => {
        totalSamples += chunk.length;
      });

      const combinedPCM = new Float32Array(totalSamples);
      let offset = 0;
      audioChunksRef.current.forEach((chunk) => {
        combinedPCM.set(chunk, offset);
        offset += chunk.length;
      });

      const currentEmotion = emotionDetectionEnabled
        ? emotion.aggregated || ""
        : "";
      recordingEmotionRef.current = currentEmotion;

      let emotionText = "";
      if (emotionDetectionEnabled && emotion.aggregated) {
        emotionText = `The user's facial  emotion is: ${emotion.aggregated}`;
      }

      let ttsPCM = null;
      try {
        if (emotionText) {
          ttsPCM = await synthesizeEmotionPCM(emotionText);
        }
      } catch (err) {
        addLog("TTS error, sending only user audio", "error");
      }

      // Convert user audio to 16-bit PCM
      const userPCM16 = convertTo16BitPCM(combinedPCM);

      let finalPCM;
      if (ttsPCM && ttsPCM.length > 0) {
        // Combine TTS and user audio (both now in 16-bit format)
        finalPCM = new Int16Array(ttsPCM.length + userPCM16.length);
        finalPCM.set(ttsPCM, 0);
        finalPCM.set(userPCM16, ttsPCM.length);
      } else {
        finalPCM = userPCM16;
      }

      const base64Data = convertPCMToBase64(finalPCM);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const message = {
          type: "audio_input",
          audio_data: base64Data,
          emotion: emotionDetectionEnabled ? emotion.aggregated : "",
          format: "pcm", // This should be "pcm" for Gemini Live API
          sample_rate: 16000, // Correct: 16kHz as specified
          channels: 1, // Correct: mono
          bits_per_sample: 16, // Correct: 16-bit
        };
        wsRef.current.send(JSON.stringify(message));
        addLog(
          `Audio sent (${(finalPCM.length / 16000).toFixed(
            2
          )}s) with emotion: ${
            emotionDetectionEnabled ? emotion.aggregated : "none"
          }`,
          "user-input"
        );
      }
    }

    audioChunksRef.current = [];
    audioProcessorRef.current = null;
  };

  // Refactored: analyzeDistressScore returns the score
  const analyzeDistressScore = async (inputText) => {
    if (!inputText || inputText.trim() === "") return 0;
    try {
      const formattedHistory = (conversationHistory || []).map((msg) => ({
        sender: msg.sender || '',
        type: msg.type || '',
        text: msg.text || msg.content || '',
        timestamp: msg.timestamp || null,
        emotion: msg.emotion || null,
        distress: msg.distress || null,
      }));
      // Log the payload being sent to the distress score API
      console.log("[Distress] Payload to API:", {
        text: inputText,
        conversationHistory: formattedHistory
      });
      console.log("[Distress] Endpoint:", `http://localhost:8000/api/distress-score`);
      const response = await fetch('http://localhost:8000/api/distress-score', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText, conversationHistory: formattedHistory }),
      });
      if (!response.ok) throw new Error("API error");
      const data = await response.json();
      // Always update distress state
      setDistress(data.score || 0);
      // Show notification only if distress is high
      if (typeof data.score === 'number' && data.score >= 7) {
        notification.warning({
          message: 'You may need support',
          description: (
            <div>
              <div>Your distress score is high. Consider reaching out for help:</div>
              <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none' }}>
                <li><a href="/helpline">Helpline Resources</a></li>
                <li><a href="/therapists">Book a Therapist</a></li>
                <li><a href="/relaxationtools">Relaxation Tools</a></li>
              </ul>
            </div>
          ),
          placement: 'topRight',
          duration: 0,
          style: { width: 340 },
        });
      }
      setTimeout(() => {
        console.log("[Distress] API response:", data); // Log full API response
        console.log("[Distress] Distress score for message:", data.score);
        console.log("[Distress] Emotion for message:", emotion.current);
      }, 0);
      return data.score || 0;
    } catch (err) {
      setDistress(0); // Reset distress on error
      console.error("[Distress] Distress score analysis failed", err);
      return 0;
    }
  };


  const handleUserInteraction = async () => {
    if (
      audioContextRef.current &&
      audioContextRef.current.state === "suspended"
    ) {
      await audioContextRef.current.resume();
    }
  };

  useEffect(() => {
    initializeAudioContext();

    document.addEventListener("click", handleUserInteraction);
    document.addEventListener("keydown", handleUserInteraction);

    return () => {
      document.removeEventListener("click", handleUserInteraction);
      document.removeEventListener("keydown", handleUserInteraction);

      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }

      if (audioProcessorRef.current) {
        try {
          audioProcessorRef.current.processor.disconnect();
          audioProcessorRef.current.source.disconnect();
          audioProcessorRef.current.context.close();
        } catch (error) {}
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (wsRef.current) {
        wsRef.current.close();
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      clearAudioQueue();
    };
  }, []);
  useEffect(() => {
    if (visible) {
      // Reset connection state and logs
      setIsCalling(false);
      setIsConnected(false);
      setIsRecording(false);
      setIsMuted(false);
      setConnectionStatus("disconnected");
      setLogs([]);
      setAudioQueueLength(0);
      setIsPlaying(false);
      setInputTranscript("");
      setOutputTranscript("");
      setDistress(0);
      setLog("");
      currentInputTranscriptRef.current = "";
      currentOutputTranscriptRef.current = "";
      // Optionally, re-initialize audio context if needed
      initializeAudioContext();
      // Connect to backend when modal opens
      connectToBackend();
    }
    // No cleanup needed here; handled by other effects
  }, [visible]);
  const handleClose = () => {
    // Disconnect Gemini audio session and clean up resources
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (isRecording) {
      stopRecording();
    }
    clearAudioQueue();
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
      audioContextReadyRef.current = false;
    }
    if (onClose) onClose();
    if (onAudioChatClose) onAudioChatClose(sessionId);
  };
  return (
    <Modal
      title="Gemini Audio Chat"
      visible={visible}
      onCancel={handleClose}
      footer={[
        <Button
          key="close"
          onClick={handleClose}
          disabled={isCalling || isRecording}
        >
          Close
        </Button>,
        <Button
          key="emotion"
          onClick={() => setEmotionDetectionEnabled((v) => !v)}
          type={emotionDetectionEnabled ? "primary" : "default"}
        >
          {emotionDetectionEnabled
            ? "Disable Emotion Detection"
            : "Enable Emotion Detection"}
        </Button>,
      ]}
      width={600}
    >
      <div style={{ textAlign: "center", padding: 20 }}>
        <p>Start a real-time audio conversation with the assistant.</p>
        {log && (
          <Alert
            message={log}
            type={connectionStatus === "error" ? "error" : "info"}
            showIcon
            style={{ marginTop: 10 }}
          />
        )}
        <div style={{ margin: "16px 0" }}>
          <Button
            type={isRecording ? "primary" : "default"}
            icon={isRecording ? <MicOff /> : <Mic />}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={connectionStatus !== "connected"}
            style={{ marginRight: 8 }}
          >
            {isRecording ? "Stop" : "Start"} Recording
          </Button>
        </div>
        {/* Display finalized transcripts in a styled box */}
        {(inputTranscript || outputTranscript) && (
          <div
            style={{
              margin: "16px 0",
              textAlign: "left",
              background: "#f6f6f6",
              borderRadius: 8,
              padding: 12,
            }}
          >
            {inputTranscript && (
              <div style={{ marginBottom: 6 }}>
                <b>You:</b>{" "}
                <span style={{ color: "#333" }}>{inputTranscript}</span>
              </div>
            )}
            {outputTranscript && (
              <div>
                <b>Gemini:</b>{" "}
                <span style={{ color: "#1a73e8" }}>{outputTranscript}</span>
              </div>
            )}
          </div>
        )}
        {emotionDetectionEnabled && (
          <div style={{ marginTop: 20, textAlign: "left" }}>
            <b>Detected Emotion:</b>{" "}
            <span>{emotion.aggregated || <i>Detecting...</i>}</span>
            <br />
            {emotion.playback && (
              <span style={{ color: "#888" }}>
                <b>Playback Emotion:</b> {emotion.playback}
              </span>
            )}
            <video
              ref={videoRef}
              style={{ display: "none" }}
              autoPlay
              playsInline
              width={128}
              height={96}
            />
            <canvas
              ref={canvasRef}
              style={{ display: "none" }}
              width={128}
              height={96}
            />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default GeminiAudioChatModal;
