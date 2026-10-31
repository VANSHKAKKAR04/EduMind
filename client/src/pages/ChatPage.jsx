import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Layout,
  Menu,
  Input,
  Button,
  message as antdMessage,
  Spin,
  notification,
  Modal,
} from "antd";
import { motion } from "framer-motion";
import {
  DollarOutlined,
  PhoneOutlined,
  CameraOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import {
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
  AudioOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import GeminiAudioChatModal from "../components/audio-test2";
const { Header, Sider, Content } = Layout;
import { Link } from "react-router-dom";
// Backend URLs
const NODE_BACKEND_URL = "http://localhost:4000"; // Node.js backend (user profile, chat history, saving results)
const GEMINI_BACKEND_URL = "http://localhost:8000"; // Gemini backend (chat, emotion, distress scoring)

const BACKEND_URL = NODE_BACKEND_URL;

const ChatPage = () => {
  // Connection state
  const [emotionDetectionEnabled, setEmotionDetectionEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");

  // UI state
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isCameraTestVisible, setCameraTestVisible] = useState(false);
  const [isAudioModalVisible, setIsAudioModalVisible] = useState(false);

  // Chat state
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [input, setInput] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [listening, setListening] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  // Use object for userProfile
  const [userProfile, setUserProfile] = useState({});
  // Remove conversationHistory state, use messages for history
  // const [conversationHistory,setConversationHistory]=useState([])
  // Emotion and video refs
  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Messages and input
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState("");
  const [currentResponse, setCurrentResponse] = useState("");
  const currentResponseRef = useRef("");

  // Config
  const [systemInstruction, setSystemInstruction] = useState(
    // "You are a helpful assistant. The user's profile and recent conversation are provided. Use the user's name and any relevant profile information in your responses. If the user asks for their name, use the name from the profile. Be supportive and empathetic.Reply in english by default, but change the language if the user queries in another language. Format your answer clearly and naturally, without using asterisks for emphasis. Do not include English translations or explanations in brackets. Only reply in the user's language. And if you receive a user emotion, respond in acknowledgement of that, and have emotionally supportive conversations"
    "You are a helpful assistant. The user's profile and recent conversation are provided. Use the user's name and any relevant profile information in your responses. If the user asks for their name, use the name from the profile. Be supportive and empathetic.Whenever you receive a user's current emotion, always acknowledge it explicitly in your reply, mention the emotion, and respond with empathy and support tailored to that emotion. Never ignore the user's emotion."
  );
  const [wsUrl, setWsUrl] = useState("ws://localhost:8000");
  const [profileLoading, setProfileLoading] = useState(true);
  // Stats
  const [totalTokens, setTotalTokens] = useState(0);

  // Status messages
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Refs
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageIdRef = useRef(2);
  const navigate = useNavigate();

  // Session resumption handle
  const [sessionHandle, setSessionHandle] = useState(null);
  const [resumeHandle, setResumeHandle] = useState(null);
  const [shouldReconnect, setShouldReconnect] = useState(false);

  const [distressScore, setDistressScore] = useState(null);

  // Audio conversation history state
  const [audioConversationHistory, setAudioConversationHistory] = useState([]);

  // Emotion detection effect (Webcam + Gemini emotion via WebSocket)
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
        if (videoRef.current && canvasRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.onloadedmetadata = () => {
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            // Ensure video is playing
            videoRef.current.play().catch((err) => {
              console.warn("Video play() failed:", err);
            });
            const ctx = canvasRef.current.getContext("2d");
            ctx.drawImage(
              videoRef.current,
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height
            );
          };
        }
        interval = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const canvas = canvasRef.current;
          const video = videoRef.current;

          if (video.paused || video.ended) {
            console.warn("Video is not playing");
            return;
          }

          if (!canvas || !video) return;
          if (video.readyState === 4) {
            // HAVE_ENOUGH_DATA
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height
            );
            const data = imageData.data;
            const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
            console.log("Frame mean (frontend):", mean);
            if (mean < 5) {
              // Don't send blank frames
              console.warn("Not sending blank frame");
              return;
            }
            const dataURL = canvas.toDataURL("image/png");
            const base64 = dataURL.split(",")[1];

            // const a = document.createElement("a");
            // a.href = dataURL;
            // a.download = "debug_canvas.png";
            // a.click();

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

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, currentResponse]);

  // Auto-hide status messages
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (shouldReconnect && resumeHandle) {
      setShouldReconnect(false);
      setTimeout(() => {
        console.log(
          "[Client] Triggering session reconnect with resume handle:",
          resumeHandle
        );
        connect(true);
      }, 500);
    }
  }, [shouldReconnect, resumeHandle]);

  const fetchSessions = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await axios.get(`${BACKEND_URL}/api/chat/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setChatSessions(response.data);
      const savedSession = localStorage.getItem("activeSession");
      const validSession = response.data.find(
        (session) => session._id === savedSession
      );

      if (validSession) {
        setActiveSession(savedSession);
      } else if (response.data.length > 0) {
        setActiveSession(response.data[0]._id);
        localStorage.setItem("activeSession", response.data[0]._id);
      } else {
        const newSession = await axios.post(
          `${BACKEND_URL}/api/chat/sessions`,
          { sessionName: "Session 1" },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setChatSessions([newSession.data]);
        setActiveSession(newSession.data._id);
        localStorage.setItem("activeSession", newSession.data._id);
      }
    } catch (error) {
      antdMessage.error("Failed to fetch chat sessions.");
      console.error("Failed to fetch sessions:", error);
    }
  }, [BACKEND_URL]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);
  // When switching sessions, fetch messages from backend
  useEffect(() => {
    if (activeSession) {
      fetchMessages(activeSession);
      localStorage.setItem("activeSession", activeSession);
    }
  }, [activeSession]);

  // WebSocket message handler
  const handleServerMessage = useCallback((data) => {
    if (data.type === "session_warning" && data.resume_handle) {
      setResumeHandle(data.resume_handle);
      setShouldReconnect(true);
      addSystemMessage("Session expiring, reconnecting to resume...");
    }

    if (data.emotion) {
      setEmotion(data.emotion);
      return;
    }

    if (data.error) {
      showError(data.error);
      return;
    }

    // Defensive: If Gemini returns an unsupported format, log to console but do not show UI error
    if (
      !data.type &&
      !data.serverContent &&
      !data.text_chunk &&
      !data.generation_complete
    ) {
      console.warn("Received unsupported message format:", data);
      return;
    }

    switch (data.type) {
      case "connection_established":
        showSuccess(data.message || "Connected to Live API Bridge");
        break;
      case "session_started":
        setHasActiveSession(true);
        showSuccess("Session started successfully");
        addSystemMessage("Session started - You can now send messages");
        break;
      case "setup_complete":
        console.log("setup complete!!!");
        setHasActiveSession(true);
        // addSystemMessage("Session setup complete - You can now send messages"); // Removed per user request
        break;
      case "session_ended":
        setHasActiveSession(false);
        addSystemMessage("Session ended");
        break;

      case "text_chunk":
        // Always append to a ref, not just state
        if (typeof data.content === "string") {
          currentResponseRef.current += data.content;
          setCurrentResponse(currentResponseRef.current); // for typing indicator
        }

        if (data.complete) {
          setIsTyping(false);
          if (
            currentResponseRef.current &&
            currentResponseRef.current.trim() !== ""
          ) {
            addMessage("model", currentResponseRef.current);
            if (activeSession) {
              saveMessage(activeSession, {
                sender: "bot",
                type: "model",
                text: currentResponseRef.current,
                timestamp: new Date().toISOString(),
              });
            }
          }
          setCurrentResponse("");
          currentResponseRef.current = "";
        } else {
          setIsTyping(true);
        }
        break;

      case "generation_complete":
        setIsTyping(false);
        if (currentResponseRef.current) {
          // Save user message before model message
          if (activeSession && messages.length > 0) {
            const lastUserMsg = messages[messages.length - 1];
            if (lastUserMsg.type === "user") {
              saveMessage(activeSession, {
                sender: "user",
                type: "user",
                text: lastUserMsg.content,
                emotion: emotion.current,
                distress: distressScore,
                timestamp: lastUserMsg.timestamp,
              });
            }
          }
          addMessage("model", currentResponseRef.current);
          // Save model message to backend after each model response
          if (activeSession) {
            saveMessage(activeSession, {
              type: "model",
              text: currentResponseRef.current,
              timestamp: new Date().toISOString(),
            });
          }
        }
        setCurrentResponse("");
        currentResponseRef.current = "";
        break;

      case "message_sent":
        console.log("[Client] Message acknowledged by server");
        break;
      case "usage_update":
        if (data.total_tokens) {
          setTotalTokens(data.total_tokens);
        }
        break;
      case "tool_call":
        addSystemMessage(`Tool called: ${data.tool_call}`);
        break;
      case "interrupted":
        setIsTyping(false);
        setCurrentResponse("");
        currentResponseRef.current = "";
        addSystemMessage("Generation was interrupted");
        break;
      case "session_warning":
        showError(data.message || "Session warning");
        break;
      case "configuration_updated":
        showSuccess(data.message || "Configuration updated");
        break;
      case "error":
        setIsTyping(false);
        setCurrentResponse("");
        currentResponseRef.current = "";
        // Do not show error in UI for Gemini errors; just log
        console.error(
          "[Gemini] Error message:",
          data.message || "An error occurred"
        );
        break;
      case "session_resumption_update":
        if (data.handle) {
          setSessionHandle(data.handle);
          addSystemMessage("Session can be resumed.");
        }
        break;
      default:
        console.log("[Client] Unhandled message type:", data.type, data);
    }
  }, []);

  // Simple text formatting function
  const formatText = (text) => {
    return text?.replace(/\n/g, "<br/>") || "";
  };

  // Helper functions
  const addMessage = (type, content) => {
    if (type !== "user" && type !== "model" && type !== "system") return;
    const newMessage = {
      id: messageIdRef.current++,
      type,
      content,
      sender: type === "user" ? "user" : type === "model" ? "bot" : "system",
      text: content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setAudioConversationHistory((prev) => [...prev, newMessage]); // <-- append to audio history
  };

  const addSystemMessage = (content) => {
    addMessage("system", content);
  };

  const showError = (message) => {
    setErrorMessage(message);

    console.error("[Client] Error:", message);
  };

  const showSuccess = (message) => {
    setSuccessMessage(message);
    antdMessage.success(message);
  };

  const sendToServer = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const buildConversationTurns = (newUserMessage = null) => {
    const conversationMessages = messages.filter(
      (m) => m.type === "user" || m.type === "model"
    );
    const turns = [];
    conversationMessages.forEach((msg) => {
      if (msg.type === "user") {
        turns.push({ role: "user", parts: [{ text: msg.content.trim() }] });
      } else if (msg.type === "model") {
        turns.push({ role: "model", parts: [{ text: msg.content.trim() }] });
      }
    });
    if (newUserMessage) {
      turns.push({ role: "user", parts: [{ text: newUserMessage.trim() }] });
    }

    let lastRole = null;
    const filteredTurns = [];
    for (const turn of turns) {
      if (turn.role !== lastRole) {
        filteredTurns.push(turn);
        lastRole = turn.role;
      }
    }

    return filteredTurns;
  };

  const connect = async () => {
    const url = wsUrl.trim();
    if (!url) {
      showError("Please enter a WebSocket URL");
      return;
    }

    try {
      wsRef.current = new WebSocket(url);

      // ...existing code...
      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionStatus("Connected");
        showSuccess("Connected to WebSocket server");

        // Prepare conversation history for Gemini
        const conversation_history = (messages || []).map((msg) => ({
          sender: msg.sender,
          type: msg.type,
          text: msg.text || msg.content || "",
          timestamp: msg.timestamp,
          emotion: msg.emotion,
          distress: msg.distress,
        }));

        const setupMsg = {
          setup: {
            model: "gemini-3.1-flash-live-preview",
            generationConfig: {
              responseModalities: ["TEXT"],
            },
            systemInstruction: systemInstruction.trim() || undefined,
            tools: toolsEnabled ? [{}] : undefined,
            systemContext: {
              user_profile: userProfile,
              conversation_history,
            },
            ...(resumeHandle
              ? { sessionResumption: { handle: resumeHandle } }
              : {}),
          },
        };
        wsRef.current.send(JSON.stringify(setupMsg));
        // ...existing code...
      };
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleServerMessage(data);
        } catch (error) {
          console.error("[Client] Error parsing server message:", error);
        }
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setHasActiveSession(false);
        setConnectionStatus("Disconnected");
        setIsTyping(false);
        setCurrentResponse("");
        currentResponseRef.current = "";
        addSystemMessage(`Disconnected from server (Code: ${event.code})`);
        if (resumeHandle) {
          console.log(
            "[Client] Disconnected, will attempt to reconnect with resume handle:",
            resumeHandle
          );
          setTimeout(() => {
            connect(true);
          }, 500);
        }
      };

      wsRef.current.onerror = (error) => {
        showError("WebSocket connection error");
        console.error("[Client] WebSocket error:", error);
      };
    } catch (error) {
      showError("Failed to connect: " + error.message);
    }
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      console.log("[Client] Manually disconnected from WebSocket server");
    }
  };

  // Distress score analysis (Gemini backend)
  const analyzeDistressScore = async (inputText) => {
    if (!inputText || inputText.trim() === "") return;
    try {
      // Format conversationHistory to match backend schema
      const formattedHistory = (messages || []).map((msg) => ({
        sender: msg.sender || '',
        type: msg.type || '',
        text: msg.text || msg.content || '',
        timestamp: msg.timestamp || null,
        emotion: msg.emotion || null,
        distress: msg.distress || null,
      }));
      console.log("[Distress] Sending text for distress score:", inputText); // Log input
      const response = await fetch(`${GEMINI_BACKEND_URL}/api/distress-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText, conversationHistory: formattedHistory }),
      });
      if (!response.ok) throw new Error("API error");
      const data = await response.json();
      setDistressScore(data.score);
      if (data.score >= 7) {
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
    } catch (err) {
      console.error("[Distress] Distress score analysis failed", err);
    }
  };

  const sendMessage = async () => {
    const message = (messageInput || input).trim();
    if (!message || !hasActiveSession || isTyping) {
      console.log("[Client] Cannot send message:", {
        message: !!message,
        hasActiveSession,
        isTyping,
      });
      return;
    }

    const turns = buildConversationTurns(message);
    const payload = {
      clientContent: {
        turns: turns,
        turnComplete: true,
        emotion: emotion.current,
      },
    };

    console.log("[Client] Sending message with payload:", payload);
    sendToServer(payload);

    addMessage("user", message);
    analyzeDistressScore(message);
    setMessageInput("");
    setInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
  };

  const startSession = async () => {
    if (!isConnected) {
      showError("Not connected to server");
      return;
    }

    const message = (messageInput || input).trim();
    if (!message) {
      showError("Please enter a message to start the session.");
      return;
    }
    const turns = buildConversationTurns(message);

    const payload = {
      clientContent: {
        turns: turns,
        turnComplete: true,
        emotion: emotion.current,
      },
    };

    // Only log for the very first session start
    if (!hasActiveSession) {
      console.log("[Client] Starting session with payload:", payload);
    }
    sendToServer(payload);

    addMessage("user", message);
    setMessageInput("");
    setInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (hasActiveSession) {
        sendMessage();
      } else {
        startSession();
      }
    }
  };
  const handleAudioChatClose = async (sessionId) => {
    if (!sessionId) return;
    await fetchMessages(sessionId); // Refresh messages from backend
    // Re-initiate Gemini session with updated conversation history
    setupGeminiSession(sessionId);
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (hasActiveSession) {
        sendMessage();
      } else {
        startSession();
      }
    }
  };

  const handleSendMessage = () => {
    if (hasActiveSession) {
      sendMessage();
    } else {
      startSession();
    }
  };

  // Helper to get auth headers
  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Fetch chat sessions from Node backend

  // Create a new session in Node backend
  const createSession = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(
        `${BACKEND_URL}/api/chat/sessions`,
        { sessionName: `Chat ${chatSessions.length + 1}` },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const newSession = response.data;
      await fetchSessions(); // Refresh session list immediately
      setActiveSession(newSession._id);
      localStorage.setItem("activeSession", newSession._id);
      setMessages([]); // No system message on new session
      messageIdRef.current = 2;
    } catch (err) {
      showError("Failed to create session");
    }
  };

  // Fetch conversation history for a session from Node backend
  const fetchMessages = async (sessionId) => {
    try {
      const res = await fetch(
        `${NODE_BACKEND_URL}/api/chat/sessions/${sessionId}`,
        {
          headers: {
            ...getAuthHeaders(),
          },
        }
      );
      const data = await res.json();
      if (data.messages) {
        // Sort messages by timestamp (or fallback to _id if timestamp missing)
        const sortedMessages = [...data.messages].sort((a, b) => {
          const aTime = a.timestamp
            ? new Date(a.timestamp).getTime()
            : a._id || 0;
          const bTime = b.timestamp
            ? new Date(b.timestamp).getTime()
            : b._id || 0;
          return aTime - bTime;
        });
        const formattedMessages = sortedMessages.map((msg, idx) => {
          // Robustly map backend message fields to UI format
          let sender = "system";
          if (msg.sender === "user" || msg.type === "user") sender = "user";
          else if (msg.sender === "bot" || msg.type === "model") sender = "bot";
          // Prefer 'text', fallback to 'content', fallback to empty string
          const text =
            typeof msg.text === "string" && msg.text.trim() !== ""
              ? msg.text
              : typeof msg.content === "string"
              ? msg.content
              : "";
          return {
            ...msg,
            id: idx + 1,
            sender,
            text,
            content: text, // for compatibility
          };
        });
        console.log("conversationHistory", formattedMessages);
        setMessages(formattedMessages);
        setAudioConversationHistory(formattedMessages); // <-- set audio history
        messageIdRef.current = data.messages.length + 1;
      } else {
        setMessages([]);
        setAudioConversationHistory([]); // <-- clear audio history
        messageIdRef.current = 1;
      }
    } catch (err) {
      showError("Failed to fetch messages");
      setMessages([]);
      setAudioConversationHistory([]); // <-- clear audio history
      messageIdRef.current = 1;
    }
  };

  // Save a message to Node backend
  const saveMessage = async (sessionId, message) => {
    try {
      console.log("[saveMessage] Sending to backend:", message);
      const res = await fetch(
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
      if (!res.ok) {
        const errorText = await res.text();
        console.error(
          `[saveMessage] Backend responded with status ${res.status}:`,
          errorText
        );
      }
    } catch (err) {
      console.error("Failed to save message", err);
    }
  };

  // On mount, fetch sessions from backend
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // When switching sessions, fetch messages from backend
  useEffect(() => {
    if (activeSession) {
      fetchMessages(activeSession);
    }
  }, [activeSession]);

  // Update handleNewSession to use backend
  const handleNewSession = () => {
    createSession();
  };

  // Save user and model messages to backend after each exchange
  useEffect(() => {
    // Only save if last two messages are user and model
    if (!activeSession || messages.length < 2) return;
    const last = messages[messages.length - 1];
    const secondLast = messages[messages.length - 2];
    if (secondLast.type === "user" && last.type === "model") {
      // Save user message
      if (secondLast.content && secondLast.content.trim() !== "") {
        saveMessage(activeSession, {
          sender: "user",
          type: "user",
          text: secondLast.content,
          emotion: emotion.current,
          distressScore: distressScore,
          timestamp: secondLast.timestamp,
        });
      }
      // Save model message (must have sender and non-empty content)
      if (last.content && last.content.trim() !== "") {
        saveMessage(activeSession, {
          sender: "bot",
          type: "model",
          text: last.content,
          timestamp: last.timestamp,
        });
      }
    }
  }, [messages, activeSession, distressScore]);

  // Emotion detection settings modal
  const handleConfigSubmit = (values) => {
    console.log("Config values:", values);
    setSystemInstruction(values.systemInstruction);
    setToolsEnabled(values.toolsEnabled);
    setShowConfig(false);
    showSuccess("Settings updated");
  };

  // Fetch user profile from backend
  const fetchUserProfile = async () => {
    setProfileLoading(true);
    try {
      const res = await fetch(`${NODE_BACKEND_URL}/api/profile`, {
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error("Failed to fetch user profile");
      const data = await res.json();
      // If your API returns { userProfile: { ... } }
      const raw = data.userProfile || data;

      // Map backend fields to Gemini fields
      const mappedProfile = {
        name: raw.name,
        age: raw.age,
        gender: raw.gender,
        stressFrequency: raw.stressFrequency,
        sleep: raw.sleepHours ? `${raw.sleepHours} hours/night` : undefined,
        exercise: raw.exerciseFrequency,
        triggers: raw.triggers || [],
        copingMechanisms: raw.copingMechanisms || [],
        supportSystem: raw.hasSupportSystem === true ? "Yes" : "No",
        preferredLanguage: raw.preferredLanguage,
        responseStyle: raw.responsePreference,
        preferences: [
          ...(raw.wantsAffirmations ? ["Daily Affirmations"] : []),
          ...(raw.wantsReminders ? ["Wellness Check-ins"] : []),
        ],
      };

      setUserProfile(mappedProfile);
    } catch (err) {
      console.error("Error fetching user profile:", err);
      setUserProfile(null);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    fetchUserProfile();
  }, []);
  // Gemini session setup with context (now async, fetches user profile and session messages)
  const setupGeminiSession = useCallback(
    async (sessionId) => {
      try {
        // Only include user and model messages
        const conversation_history = (messages || [])
          .filter((msg) => msg.type === "user" || msg.type === "model")
          .map((msg) => ({
            sender: msg.sender,
            type: msg.type,
            text: msg.text || msg.content || "",
            timestamp: msg.timestamp,
            emotion: msg.emotion,
            distress: msg.distress,
          }));

        const systemContext = {
          user_profile: userProfile,
          conversation_history,
        };

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              setup: {
                model: "gemini-3.1-flash-live-preview",
                systemContext,
                systemInstruction: systemInstruction.trim() || undefined,
                tools: toolsEnabled ? [{}] : undefined,
              },
            })
          );
        }
      } catch (err) {
        console.error("Failed to setup Gemini session with context:", err);
      }
    },
    [systemInstruction, toolsEnabled, messages, userProfile]
  );
  // Connect and setup session when active session changes
  useEffect(() => {
    if (
      profileLoading ||
      !activeSession ||
      !userProfile ||
      Object.keys(userProfile).length === 0 ||
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connect();
    }

    const timeout = setTimeout(() => {
      setupGeminiSession(activeSession);
    }, 500);
    return () => clearTimeout(timeout);
  }, [
    activeSession,
    userProfile,
    messages,
    setupGeminiSession,
    profileLoading,
  ]);

  // Mock CameraTest component
  const CameraTest = ({ isVisible, onClose }) => (
    <Modal
      title="Camera Test"
      visible={isVisible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      <div style={{ textAlign: "center", padding: "20px" }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          style={{ width: "100%", maxWidth: "300px" }}
        />
        <p>Current Emotion: {emotion.current || "None detected"}</p>
        <Button
          onClick={() => setEmotionDetectionEnabled(!emotionDetectionEnabled)}
          type={emotionDetectionEnabled ? "danger" : "primary"}
        >
          {emotionDetectionEnabled ? "Stop Detection" : "Start Detection"}
        </Button>
      </div>
    </Modal>
  );

  // Mock Loader component
  const Loader = () => (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100px",
      }}
    >
      <Spin size="large" />
    </div>
  );

  // Helper to close the main chat WebSocket connection
  const closeChatSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setIsConnected(false);
      setConnectionStatus("Disconnected");
      setHasActiveSession(false);
      setIsTyping(false);
      setCurrentResponse("");
      currentResponseRef.current = "";
      addSystemMessage("Disconnected from server (closed for audio modal)");
    }
  };

  return (
    <>
      {/* Always render the hidden video and canvas for emotion detection */}
      <video
        ref={videoRef}
        style={{ display: "none" }}
        autoPlay
        muted
        width="640"
        height="480"
      />
      <canvas
        ref={canvasRef}
        style={{ display: "none" }}
        width="640"
        height="480"
      />
      <Layout style={{ height: "100vh" }}>
        <Sider
          width={250}
          collapsible
          collapsed={collapsed}
          collapsedWidth={50}
          onCollapse={(collapsed) => setCollapsed(collapsed)}
          style={{
            height: "100vh",
            background: "#f9a8d4",
            color: "#fff",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px", textAlign: "center" }}>
            <h3 style={{ color: "#fff", margin: 0 }}>
              {!collapsed ? "Chat Sessions" : "💬"}
            </h3>
          </div>

          <Menu
            theme="light"
            mode="inline"
            selectedKeys={[activeSession]}
            onClick={({ key }) => {
              setActiveSession(key);
              localStorage.setItem("activeSession", key);
              fetchMessages(key);
            }}
            style={{ background: "transparent", border: "none" }}
            items={chatSessions.map((session) => ({
              key: session._id,
              icon: <MessageOutlined />,
              label: !collapsed ? session.sessionName : "",
            }))}
          />

          <div
            style={{
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleNewSession}
              style={{
                backgroundColor: "#ff4caf",
                borderColor: "#d9363e",
                color: "white",
                fontWeight: "bold",
                borderRadius: "8px",
                height: "40px",
              }}
            >
              {!collapsed && <span>New Chat</span>}
            </Button>

            <Button
              type="primary"
              icon={<PhoneOutlined />}
              onClick={() => {
                setIsAudioModalVisible(true);
              }}
              style={{
                backgroundColor: "#007AFF",
                borderColor: "#0056b3",
                color: "white",
                fontWeight: "bold",
                borderRadius: "8px",
                height: "40px",
              }}
            >
              {!collapsed && <span>Switch to Audio</span>}
            </Button>

            <Button
              type="primary"
              icon={<CameraOutlined />}
              onClick={() => setEmotionDetectionEnabled((prev) => !prev)}
              style={{
                backgroundColor: emotionDetectionEnabled
                  ? "#d32f2f"
                  : "#4CAF50",
                borderColor: emotionDetectionEnabled ? "#b71c1c" : "#388E3C",
                color: "white",
                fontWeight: "bold",
                borderRadius: "8px",
                height: "40px",
              }}
            >
              {!collapsed && (
                <span>
                  {emotionDetectionEnabled
                    ? "Stop Emotion Capture"
                    : "Capture Emotion"}
                </span>
              )}
            </Button>
          </div>
        </Sider>

        <Layout>
          <Content
            style={{
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              height: "100vh",
              background: "#fff",
            }}
          >
            <motion.div
              style={{
                flex: 1,
                overflowY: "auto",
                marginBottom: "20px",
                padding: "10px",
                border: "1px solid #e8e8e8",
                borderRadius: "8px",
              }}
            >
              {messages.map((msg, index) => (
                <motion.div
                  key={msg.id || index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    marginBottom: "15px",
                    padding: "10px",
                    borderRadius: "8px",
                    backgroundColor:
                      msg.sender === "user"
                        ? "#e6f7ff"
                        : msg.sender === "bot"
                        ? "#f6ffed"
                        : "#f0f0f0",
                    alignSelf:
                      msg.sender === "user" ? "flex-end" : "flex-start",
                    maxWidth: "80%",
                    marginLeft: msg.sender === "user" ? "auto" : "0",
                    marginRight: msg.sender === "user" ? "0" : "auto",
                  }}
                >
                  <div>
                    <strong>
                      {msg.sender === "user"
                        ? "You"
                        : msg.sender === "bot"
                        ? "Assistant"
                        : "System"}
                      :
                    </strong>
                  </div>
                  {msg.jsx ? (
                    msg.jsx
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: formatText(msg.text || msg.content || ""),
                      }}
                    />
                  )}
                </motion.div>
              ))}

              {isTyping && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    padding: "10px",
                    backgroundColor: "#f6ffed",
                    borderRadius: "8px",
                    marginBottom: "10px",
                  }}
                >
                  <strong>Assistant:</strong> {currentResponse}
                  <Spin size="small" style={{ marginLeft: "10px" }} />
                </motion.div>
              )}

              {loading && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "rgba(255,255,255,0.8)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 1000,
                  }}
                >
                  <Loader />
                </div>
              )}

              <div ref={messagesEndRef} />
            </motion.div>

            <div
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                padding: "10px",
                background: "#fafafa",
                borderRadius: "8px",
              }}
            >
              <Input
                value={input || messageInput}
                onChange={(e) => {
                  setInput(e.target.value);
                  setMessageInput(e.target.value);
                }}
                onKeyPress={handleKeyPress}
                placeholder="Ask what you want..."
                style={{ flex: 1 }}
              />

              <Button
                icon={<AudioOutlined />}
                onClick={() => {
                  if (listening) {
                    setListening(false);
                    console.log("Stopped listening");
                  } else {
                    resetTranscript();
                    setListening(true);
                    console.log("Started listening");
                  }
                }}
                type={listening ? "danger" : "default"}
              />

              <Button
                icon={<SendOutlined />}
                onClick={handleSendMessage}
                type="primary"
                disabled={isTyping}
              />
            </div>

            {audioUrl && (
              <Button
                onClick={handlePlayAudio}
                style={{ marginTop: "10px", alignSelf: "center" }}
              >
                🔊 Play Audio Response
              </Button>
            )}
          </Content>
        </Layout>
      </Layout>

      <GeminiAudioChatModal
        visible={isAudioModalVisible}
        onClose={() => setIsAudioModalVisible(false)}
        userProfile={userProfile}
        conversationHistory={audioConversationHistory}
        sessionId={activeSession}
        onAudioChatClose={handleAudioChatClose}
      />
    </>
  );
};

export default ChatPage;
