import cv2
from emotion_service import EmotionService

def main():
    emotion_service = EmotionService()
    cap = cv2.VideoCapture(0)
    print("Press SPACE to capture a frame and analyze emotion, or ESC to exit.")
    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to grab frame.")
            break
        cv2.imshow("Webcam", frame)
        key = cv2.waitKey(1)
        if key == 27:  # ESC
            break
        elif key == 32:  # SPACE
            # Convert frame to RGB for DeepFace
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            emotion = emotion_service.analyze_frame(rgb_frame)
            print(f"Detected emotion: {emotion}")
            print(f"Buffer: {list(emotion_service.buffer)}")
            print(f"Aggregated emotion: {emotion_service.get_aggregated_emotion()}")
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()