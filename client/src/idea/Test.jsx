import React, { useState, useEffect, useRef, useCallback } from "react";

const Test = () => {
  // Connection state

  const [emotionDetectionEnabled, setEmotionDetectionEnabled] = useState(false);

  const [isConnected, setIsConnected] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");

  // UI state
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });
  // const emotionSocketRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!emotionDetectionEnabled) return;
    let interval;
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        interval = setInterval(() => {
          const ws = wsRef.current; // <-- use main chat websocket
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (canvas && video) {
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg");
            const base64 = dataURL.split(",")[1];
            ws.send(JSON.stringify({ frame: base64 }));
          }
        }, 1000);
      })
      .catch((err) => console.error("Error accessing webcam:", err));

    return () => {
      if (interval) clearInterval(interval);
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, [emotionDetectionEnabled]);
  // Messages and input
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: "system",
      content:
        "Welcome to Live API Chat Demo! Connect to the WebSocket server and start a session to begin chatting.",
    },
  ]);
  const [messageInput, setMessageInput] = useState("");
  const [currentResponse, setCurrentResponse] = useState("");
  const currentResponseRef = useRef("");

  // Config
  const [systemInstruction, setSystemInstruction] = useState(
    "Reply in english by default, but change the language if the user queries in another language. Format your answer clearly and naturally, without using asterisks for emphasis. Do not include English translations or explanations in brackets. Only reply in the user's language. And if you receive a user emotion, respond in acknowledgement of that, and have emotionally supportive conversations"
  );
  const [wsUrl, setWsUrl] = useState("ws://localhost:8000");

  // "Reply in english by default, but change the language if the user queries in another language. Format your answer clearly and naturally, without using asterisks for emphasis. Do not include English translations or explanations in brackets. Only reply in the user's language."

  // Stats
  const [totalTokens, setTotalTokens] = useState(0);

  // Status messages
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Refs
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageIdRef = useRef(2);

  // Session resumption handle
  const [sessionHandle, setSessionHandle] = useState(null);
  //Auto Reconnect
  const [resumeHandle, setResumeHandle] = useState(null);
  const [shouldReconnect, setShouldReconnect] = useState(false);

  const [distressScore, setDistressScore] = useState(null);
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
      // Wait a moment to ensure the socket is closed before reconnecting
      setTimeout(() => {
        console.log(
          "[Client] Triggering session reconnect with resume handle:",
          resumeHandle
        );
        connect(true); // Pass a flag to indicate resumption
      }, 500);
    }
  }, [shouldReconnect, resumeHandle]);
  // WebSocket message handler
  const handleServerMessage = useCallback((data) => {
    // Only log session reconnect events
    if (data.type === "session_warning" && data.resume_handle) {
      setResumeHandle(data.resume_handle);
      setShouldReconnect(true);
      addSystemMessage("Session expiring, reconnecting to resume...");
    }
    // Handle serverContent from Gemini Live API
    if (data.emotion) {
      setEmotion(data.emotion);
      return;
    }
    if (data.error) {
      showError(data.error);
      return;
    }
    if (data.serverContent) {
      const modelTurn = data.serverContent.modelTurn;
      if (modelTurn && modelTurn.parts && modelTurn.parts.length > 0) {
        const text = modelTurn.parts[0].text;
        setCurrentResponse((prev) => {
          const updated = prev + text;
          currentResponseRef.current = updated;
          return updated;
        });
        setIsTyping(true);
      }
      if (data.serverContent.generationComplete) {
        if (currentResponseRef.current) {
          addMessage("model", currentResponseRef.current);
        }
        setCurrentResponse("");
        currentResponseRef.current = "";
        setIsTyping(false);
      }
      if (data.serverContent.turnComplete) {
        console.log("[Client] Turn complete");
      }
      return;
    }
    // Handle setupComplete to mark session as active
    if (data.setupComplete !== undefined) {
      setHasActiveSession(true);
      addSystemMessage("Session setup complete - You can now send messages");
      return;
    }
    // Handle other message types
    switch (data.type) {
      case "connection_established":
        showSuccess(data.message || "Connected to Live API Bridge");
        break;

      case "session_started":
        setHasActiveSession(true);
        showSuccess("Session started successfully");
        addSystemMessage("Session started - You can now send messages");
        break;

      case "session_ended":
        setHasActiveSession(false);
        addSystemMessage("Session ended");
        break;

      case "text_chunk":
        // Handle streaming text from the model

        if (!data.complete) {
          setIsTyping(true);
          setCurrentResponse((prev) => {
            const updated = prev + data.content;
            currentResponseRef.current = updated;
            return updated;
          });
        }
        break;

      case "generation_complete":
        setIsTyping(false);

        // Only add message if we have accumulated response and no serverContent message handled it
        if (currentResponseRef.current) {
          addMessage("model", currentResponseRef.current);
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
        showError(data.message || "An error occurred");
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

  // Helper functions
  const addMessage = (type, content) => {
    // Only allow 'user', 'model', or 'system' types
    if (type !== "user" && type !== "model" && type !== "system") return;
    const newMessage = {
      id: messageIdRef.current++,
      type,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
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
  };

  const sendToServer = (message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  // Build conversation turns for Gemini (only include actual conversation messages)
  const buildConversationTurns = (newUserMessage = null) => {
    // Only use 'user' and 'model' types, never 'assistant'
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
    // Enforce strict alternation: user, model, user, model...
    // Remove any duplicate roles in a row
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

  // Connection handlers
  const connect = async () => {
    const url = wsUrl.trim();
    if (!url) {
      showError("Please enter a WebSocket URL");
      return;
    }

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setConnectionStatus("Connected");
        showSuccess("Connected to WebSocket server");
        // Send initial setup message
        const setupMsg = {
          setup: {
            model: "gemini-3.1-flash-live-preview",
            generationConfig: {
              responseModalities: ["TEXT"],
            },
            systemInstruction: systemInstruction.trim() || undefined,
            tools: toolsEnabled ? [{}] : undefined,
            ...(resumeHandle
              ? { sessionResumption: { handle: resumeHandle } }
              : {}),
          },
        };
        wsRef.current.send(JSON.stringify(setupMsg));
        if (resumeHandle) {
          console.log(
            "[Client] Reconnected and sent setup with resume handle:",
            resumeHandle
          );
        }
        setResumeHandle(null);
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
            connect(true); // will use resumeHandle in setup
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


  const analyzeDistressScore = async (inputText) => {
    if (!inputText || inputText.trim() === '') return;
    try {
      addLog('Analyzing distress score...', 'info');
      // Replace this URL with your actual Gemini text API endpoint
      const response = await fetch('http://localhost:8000/api/distress-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText })
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      setDistressScore(data.score); // Fix: set only the score, not the whole object
      console.log(data.score)
    } catch (err) {
      addLog('Distress score analysis failed', 'error');
    }
  };


  // Session handlers
  const startSession = async () => {
    if (!isConnected) {
      showError("Not connected to server");
      return;
    }

    const message = messageInput.trim();
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

    console.log("[Client] Starting session with payload:", payload);
    sendToServer(payload);

    // Add user message and prepare for response
    addMessage("user", message);
    setMessageInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
  };

  const endSession = async () => {
    if (!hasActiveSession) return;

    sendToServer({
      type: "end_session",
    });
    console.log("[Client] End session request sent");
  };

  // Message handlers
  const sendMessage = async () => {
    const message = messageInput.trim();
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

    // Add user message and prepare for response
    addMessage("user", message);
    analyzeDistressScore(message);
    setMessageInput("");
    setIsTyping(true);
    setCurrentResponse("");
    currentResponseRef.current = "";
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

  // Control handlers
  const toggleTools = () => {
    setToolsEnabled(!toolsEnabled);
  };

  const toggleConfig = () => {
    setShowConfig(!showConfig);
  };

  const clearChat = () => {
    setMessages([
      {
        id: 1,
        type: "system",
        content: "Chat cleared. Welcome to Live API Chat Demo!",
      },
    ]);
    messageIdRef.current = 2;
    setTotalTokens(0);
    setSessionHandle(null);
    setCurrentResponse("");
    currentResponseRef.current = "";
    setIsTyping(false);
    console.log("[Client] Chat cleared");
  };

  const saveConfig = () => {
    showSuccess("Configuration saved");
    setShowConfig(false);
    console.log("[Client] Configuration saved:", {
      systemInstruction,
      wsUrl,
      toolsEnabled,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-400 via-purple-500 to-purple-700 flex items-center justify-center p-5">
      <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl w-full max-w-4xl h-[600px] flex flex-col overflow-hidden border border-white/20">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white p-5 text-center">
          <h1 className="text-2xl font-bold mb-1">Live API Chat Demo</h1>
          <div className="flex items-center justify-center gap-2 text-sm opacity-90">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-400" : "bg-red-400"
              } animate-pulse`}
            ></div>
            <span>{connectionStatus}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 bg-black/5 border-b border-black/10 flex flex-wrap gap-3 items-center">
          <div className="flex gap-2">
            <button
              onClick={connect}
              disabled={isConnected}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              Connect
            </button>
            <button
              onClick={disconnect}
              disabled={!isConnected}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              Disconnect
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={startSession}
              disabled={!isConnected || hasActiveSession}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              Start Session
            </button>
            <button
              onClick={endSession}
              disabled={!hasActiveSession}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              End Session
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600">
              Tools:
            </label>
            <button
              onClick={toggleTools}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                toolsEnabled ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <div
                className={`absolute w-4 h-4 bg-white rounded-full top-0.5 transition-transform ${
                  toolsEnabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              ></div>
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={toggleConfig}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              Config
            </button>
            <button
              onClick={clearChat}
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Config Panel */}
        {showConfig && (
          <div className="p-4 bg-black/5 border-b border-black/10 animate-in slide-in-from-top duration-300">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  System Instruction:
                </label>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  placeholder="You are a helpful assistant..."
                  className="w-full p-2 border border-gray-300 rounded-lg text-xs resize-none h-16"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  WebSocket URL:
                </label>
                <input
                  type="text"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg text-xs"
                />
              </div>
              <button
                onClick={saveConfig}
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all"
              >
                Save Config
              </button>
            </div>
          </div>
        )}

        {/* Status Messages */}
        {errorMessage && (
          <div className="bg-red-500 text-white p-3 text-sm animate-in slide-in-from-top duration-300">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="bg-green-500 text-white p-3 text-sm animate-in slide-in-from-top duration-300">
            {successMessage}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 bg-gray-50 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`animate-in slide-in-from-bottom duration-300 ${
                message.type === "user"
                  ? "text-right"
                  : message.type === "system"
                  ? "text-center"
                  : "text-left"
              }`}
            >
              <div
                className={`inline-block max-w-[70%] p-3 rounded-2xl text-sm leading-relaxed ${
                  message.type === "user"
                    ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                    : message.type === "system"
                    ? "bg-black/10 text-gray-600 text-xs"
                    : "bg-white border border-gray-200 text-gray-800"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {/* Current Streaming Response */}
          {currentResponse && (
            <div className="text-left animate-in slide-in-from-bottom duration-300">
              <div className="inline-block max-w-[70%] bg-white border border-gray-200 p-3 rounded-2xl text-sm leading-relaxed text-gray-800">
                {currentResponse}
                <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse"></span>
              </div>
            </div>
          )}

          {/* Typing Indicator */}
          {isTyping && !currentResponse && (
            <div className="text-left animate-in slide-in-from-bottom duration-300">
              <div className="inline-block bg-white border border-gray-200 p-3 rounded-2xl">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-5 bg-white border-t border-gray-200 flex gap-3 items-end">
          <div className="flex-1">
            <textarea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!hasActiveSession) {
                    startSession();
                  } else {
                    sendMessage();
                  }
                }
              }}
              placeholder={
                hasActiveSession
                  ? "Type your message here..."
                  : "Type your first message to start session..."
              }
              disabled={!isConnected || isTyping}
              className="w-full min-h-[44px] max-h-32 p-3 border-2 border-gray-200 rounded-3xl text-sm resize-none outline-none focus:border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <button
            onClick={!hasActiveSession ? startSession : sendMessage}
            disabled={!isConnected || !messageInput.trim() || isTyping}
            className="w-11 h-11 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-full flex items-center justify-center text-lg hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            ➤
          </button>
        </div>

        {/* Stats */}
        <div className="p-3 bg-black/5 text-xs text-gray-600 flex justify-between items-center">
          <span>Tokens: {totalTokens}</span>
          <span>Session: {hasActiveSession ? "Active" : "Inactive"}</span>
          <span>Status: {isTyping ? "Waiting for response..." : "Ready"}</span>
          <br />
          <span>
            Distress Score:{" "}
            {distressScore !== null ? `${distressScore} / 10` : "N/A"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 p-4">
        <button
          onClick={() => setEmotionDetectionEnabled((v) => !v)}
          className={`px-4 py-2 rounded-lg font-semibold ${
            emotionDetectionEnabled
              ? "bg-green-500 text-white"
              : "bg-gray-300 text-gray-700"
          }`}
        >
          {emotionDetectionEnabled
            ? "Stop Emotion Detection"
            : "Start Emotion Detection"}
        </button>
        {emotionDetectionEnabled && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              width={96}
              height={96}
              className="rounded-full border-2 border-blue-400 shadow"
            />
            <canvas
              ref={canvasRef}
              width={224}
              height={224}
              className="hidden"
            />
            <div>
              <div className="text-lg font-semibold">
                Current Emotion:{" "}
                <span className="font-bold">{emotion.current}</span>
              </div>
              <div className="text-sm text-gray-500">
                Aggregated: {emotion.aggregated}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Test;
