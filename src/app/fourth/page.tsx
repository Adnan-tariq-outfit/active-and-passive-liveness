"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/* -------------------------------- TYPES -------------------------------- */

type GestureStep = "BLINK" | "SMILE" | "TURN_LEFT" | "TURN_RIGHT" | "COMPLETE";

interface FaceLandmark {
  x: number;
  y: number;
  z?: number;
}

interface DetectionState {
  blinkCount: number;
  smileDetected: boolean;
  smileConsecutiveFrames: number;

  // ✅ Smile baseline
  baselineMouthWidth?: number;
  neutralSmileFrames: number;

  capturedPhotos: {
    blink?: string;
    smile?: string;
    turnLeft?: string;
    turnRight?: string;
  };

  isTransitioning: boolean;
  frameCount: number;
}

/* ------------------------------ COMPONENT ------------------------------ */

export default function FaceLiveness() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState("Position your face in the frame");
  const [step, setStep] = useState<GestureStep>("SMILE");
  const [capturedCount, setCapturedCount] = useState(0);
  const [previewPhotos, setPreviewPhotos] = useState<string[]>([]);

  const detectionStateRef = useRef<DetectionState>({
    blinkCount: 0,
    smileDetected: false,
    smileConsecutiveFrames: 0,
    baselineMouthWidth: undefined,
    neutralSmileFrames: 0,
    capturedPhotos: {},
    isTransitioning: false,
    frameCount: 0,
  });

  /* --------------------------- PHOTO CAPTURE --------------------------- */

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return "";

    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0);
    ctx.restore();

    return canvas.toDataURL("image/jpeg", 0.85);
  }, []);

  /* ------------------------- HELPER FUNCTIONS -------------------------- */

  function calculateHeadPose(landmarks: FaceLandmark[]) {
    const nose = landmarks[1];
    const left = landmarks[234];
    const right = landmarks[454];
    const center = (left.x + right.x) / 2;
    return (nose.x - center) / (Math.abs(left.x - right.x) + 0.001);
  }

  function getMouthMetrics(landmarks: FaceLandmark[]) {
    const topLip = landmarks[13];
    const bottomLip = landmarks[14];
    const leftCorner = landmarks[61];
    const rightCorner = landmarks[291];

    const mouthOpen = Math.abs(topLip.y - bottomLip.y);
    const mouthWidth = Math.abs(leftCorner.x - rightCorner.x);

    return { mouthOpen, mouthWidth };
  }

  /* ----------------------- IMPROVED SMILE LOGIC ------------------------ */

  const handleSmileDetection = useCallback(
    (landmarks: FaceLandmark[]) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning || state.smileDetected) return;

      state.frameCount++;

      // 1️⃣ Head must be straight
      const headPose = calculateHeadPose(landmarks);
      if (headPose < -0.1 || headPose > 0.1) {
        state.smileConsecutiveFrames = 0;
        setStatus("Keep your face straight 😊");
        return;
      }

      const { mouthOpen, mouthWidth } = getMouthMetrics(landmarks);

      // 2️⃣ Collect neutral baseline
      if (!state.baselineMouthWidth) {
        state.neutralSmileFrames++;
        state.baselineMouthWidth =
          (state.baselineMouthWidth || 0) + mouthWidth;

        setStatus("Relax your face 🙂");

        if (state.neutralSmileFrames >= 15) {
          state.baselineMouthWidth /=
            state.neutralSmileFrames;
        }
        return;
      }

      // 3️⃣ Relative smile strength
      const widthIncrease =
        (mouthWidth - state.baselineMouthWidth) /
        state.baselineMouthWidth;

      const isSmile =
        widthIncrease > 0.15 &&   // mouth corners stretched
        mouthOpen > 0.008 &&      // not closed
        mouthOpen < 0.06;         // not mouth open

      if (isSmile) {
        state.smileConsecutiveFrames++;

        if (state.smileConsecutiveFrames >= 3) {
          state.smileDetected = true;

          if (!state.capturedPhotos.smile) {
            const photo = capturePhoto();
            state.capturedPhotos.smile = photo;
            setCapturedCount((c) => c + 1);
            setPreviewPhotos((p) => [...p, photo]);
          }

          setStatus("Smile verified ✓");
          state.isTransitioning = true;

          setTimeout(() => {
            setStep("COMPLETE");
            setStatus("Liveness complete 🎉");
          }, 400);
        } else {
          setStatus("Nice smile… hold it 😊");
        }
      } else {
        state.smileConsecutiveFrames = 0;
        setStatus("Please smile naturally 😊");
      }
    },
    [capturePhoto]
  );

  /* --------------------------- MEDIAPIPE --------------------------- */

  useEffect(() => {
    let camera: any;
    let faceMesh: any;

    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
      });

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const { FaceMesh } = await import("@mediapipe/face_mesh");
      const { Camera } = await import("@mediapipe/camera_utils");

      faceMesh = new FaceMesh({
        locateFile: (f: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });

      faceMesh.onResults((results: any) => {
        if (!results.multiFaceLandmarks?.length) return;
        handleSmileDetection(results.multiFaceLandmarks[0]);
      });

      camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await faceMesh.send({ image: videoRef.current });
          }
        },
      });

      camera.start();
    };

    init();

    return () => {
      camera?.stop();
      faceMesh?.close();
    };
  }, [handleSmileDetection]);

  /* ------------------------------ UI ------------------------------ */

  return (
    <div style={{ textAlign: "center" }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        style={{ width: 320, transform: "scaleX(-1)" }}
      />

      <canvas ref={captureCanvasRef} style={{ display: "none" }} />

      <p>{status}</p>
      <p>Captured: {capturedCount}</p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {previewPhotos.map((p, i) => (
          <img key={i} src={p} width={100} />
        ))}
      </div>
    </div>
  );
}
