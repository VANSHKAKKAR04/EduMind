import React, { useState, useRef } from "react";
import { Modal, Button, Alert } from "antd";

// Accept userProfile and conversationHistory as props
const AudioCallModal = ({ visible, onClose, userProfile, conversationHistory }) => {
  const [isCalling, setIsCalling] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const wsRef = useRef(null);
  const [log, setLog] = useState("");

  // Connect to /audio and send setup with userProfile and conversationHistory
  const handleStartCall = async () => {
    setIsCalling(true);
    setLog("");
    setConnectionStatus("connecting");
    // Defensive logging for userProfile and conversationHistory
    if (!userProfile || Object.keys(userProfile).length === 0) {
      setLog("User profile is missing or empty. Cannot start audio call.");
      setConnectionStatus("error");
      setIsCalling(false);
      console.warn("AudioCallModal: userProfile is missing or empty", userProfile);
      return;
    }
    if (!conversationHistory) {
      setLog("Conversation history is missing or empty. Cannot start audio call.");
      setConnectionStatus("error");
      setIsCalling(false);
      console.warn("AudioCallModal: conversationHistory is missing or empty", conversationHistory);
      return;
    }
    try {
      wsRef.current = new window.WebSocket("ws://localhost:8000/audio");
      wsRef.current.onopen = () => {
        setConnectionStatus("connected");
        setLog("Connected to audio backend. Sending setup...");
        console.log("Sending setup with userProfile:", userProfile);
        console.log("Sending setup with conversationHistory:", conversationHistory);
        wsRef.current.send(
          JSON.stringify({
            type: "setup",
            config: {
              model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
              response_modalities: ["AUDIO"],
              voice_name: "Puck",
              systemContext: {
                user_profile: userProfile,
                conversation_history: conversationHistory,
              },
            },
          })
        );
      };
      wsRef.current.onerror = (e) => {
        setConnectionStatus("error");
        setLog("WebSocket error: " + e.message);
        setIsCalling(false);
      };
      wsRef.current.onclose = () => {
        setConnectionStatus("disconnected");
        setLog("Disconnected from audio backend.");
        setIsCalling(false);
      };
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'setup_complete') {
            setLog('Audio session setup complete. You can now talk!');
          } else if (data.type === 'error') {
            setLog('Backend error: ' + data.message);
            setConnectionStatus('error');
            setIsCalling(false);
          } else if (data.type === 'info') {
            setLog((prev) => prev + '\n' + data.message);
          } else if (data.type === 'audio') {
            setLog((prev) => prev + '\n[Audio data received]');
            // TODO: handle audio playback here
          } else {
            setLog((prev) => prev + '\n[Backend] ' + JSON.stringify(data));
          }
        } catch (err) {
          setLog('Message parse error: ' + err.message);
        }
      };
    } catch (err) {
      setConnectionStatus("error");
      setLog("Connection error: " + err.message);
      setIsCalling(false);
    }
  };

  return (
    <Modal
      title="Audio Conversation"
      visible={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose} disabled={isCalling}>
          Close
        </Button>,
        <Button key="start" type="primary" onClick={handleStartCall} disabled={isCalling || connectionStatus === 'connected'}>
          {isCalling ? "Connecting..." : connectionStatus === 'connected' ? "Connected" : "Start Audio Call"}
        </Button>,
      ]}
    >
      <div style={{ textAlign: "center", padding: 20 }}>
        <p>Start a real-time audio conversation with the assistant.</p>
        {log && <Alert message={log} type={connectionStatus === 'error' ? 'error' : 'info'} showIcon style={{ marginTop: 10 }} />}
      </div>
    </Modal>
  );
};

export default AudioCallModal;
