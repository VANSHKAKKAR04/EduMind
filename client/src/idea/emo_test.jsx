import React, { useEffect, useRef, useState } from "react";

const EmotionTester = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [emotion, setEmotion] = useState({ current: "", aggregated: "" });

  useEffect(() => {
    // Initialize WebSocket connection
    const ws = new WebSocket("ws://localhost:8000");

    ws.onopen = () => {
      console.log("WebSocket connected");
      ws.send(JSON.stringify({ setup: {} }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.emotion) {
        setEmotion(data.emotion);
      } else if (data.setupComplete) {
        console.log("Setup complete");
      } else {
        console.warn("Unknown message:", data);
      }
    };

    ws.onerror = (err) => console.error("WebSocket error:", err);
    ws.onclose = () => console.warn("WebSocket closed");

    setSocket(ws);
    return () => ws.close();
  }, []);

  useEffect(() => {
    // Start webcam
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const interval = setInterval(() => {
          if (!socket || socket.readyState !== WebSocket.OPEN) return;

          const canvas = canvasRef.current;
          const video = videoRef.current;
          if (canvas && video) {
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg");
            const base64 = dataURL.split(",")[1];

            socket.send(JSON.stringify({ frame: base64 }));
          }
        }, 1000); // Send frame every second

        return () => clearInterval(interval);
      })
      .catch((err) => console.error("Error accessing webcam:", err));
  }, [socket]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Real-Time Emotion Recognition</h1>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-64 rounded shadow"
      />
      <canvas ref={canvasRef} width="224" height="224" className="hidden" />

      <div className="mt-4 text-lg">
        <p>
          <strong>Current Emotion:</strong> {emotion.current}
        </p>
        <p>
          <strong>Aggregated Emotion:</strong> {emotion.aggregated}
        </p>
      </div>
    </div>
  );
};

export default EmotionTester;
