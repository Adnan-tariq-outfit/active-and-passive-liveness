"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./page.module.css";
import type {
  FaceMeshInstance,
  FaceMeshResults,
  CameraInstance,
  FaceLandmark,
  CameraConfig,
} from "@/types/mediapipe";

type GestureStep = "BLINK" | "SMILE" | "TURN_LEFT" | "TURN_RIGHT" | "COMPLETE";

interface DetectionState {
  blinkCount: number;
  blinkStartTime?: number;
  smileDetected: boolean;
  headTurnLeft: boolean;
  headTurnRight: boolean;
  lastEyeAspectRatio: number;
  consecutiveFrames: number;
  smileConsecutiveFrames: number;
  lastMouthOpenness: number;
  lastSmileLandmarks: FaceLandmark[] | null;
  capturedPhotos: { blink?: string; smile?: string; turnLeft?: string; turnRight?: string; };
  depthVariationScore: number;
  motionScore: number;
  lastLandmarks: FaceLandmark[] | null;
  frameCount: number;
  faceSizeVariation: number[];
  faceAngleVariation: number[];
  naturalBlinkDetected: boolean;
  passiveLivenessScore: number;
  passiveLivenessChecks: {
    facePresence: boolean;
    naturalMovement: boolean;
    depthVariation: boolean;
    sizeConsistency: boolean;
    angleVariation: boolean;
    blinkPattern: boolean;
  };
  startTime: number;
  isTransitioning: boolean;
}

interface VerificationResult {
  success: boolean;
  photos: { blink?: string; smile?: string; turnLeft?: string; turnRight?: string; };
  confidence: number;
  antiSpoofingScore: number;
  passiveLivenessScore: number;
  timestamp: number;
  duration: number;
}

export default function OptimizedFaceLiveness() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState("Position your face in the frame");
  const [step, setStep] = useState<GestureStep>("BLINK");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);
  const [previewPhotos, setPreviewPhotos] = useState<string[]>([]);
  const [passiveLivenessResult, setPassiveLivenessResult] = useState<{
    score: number;
    checks: {
      facePresence: boolean;
      naturalMovement: boolean;
      depthVariation: boolean;
      sizeConsistency: boolean;
      angleVariation: boolean;
      blinkPattern: boolean;
    };
  } | null>(null);

  const detectionStateRef = useRef<DetectionState>({
    blinkCount: 0,
    smileDetected: false,
    headTurnLeft: false,
    headTurnRight: false,
    lastEyeAspectRatio: 0.3,
    consecutiveFrames: 0,
    smileConsecutiveFrames: 0,
    lastMouthOpenness: 0,
    lastSmileLandmarks: null,
    capturedPhotos: {},
    depthVariationScore: 0,
    motionScore: 0,
    lastLandmarks: null,
    frameCount: 0,
    startTime: Date.now(),
    isTransitioning: false,
    faceSizeVariation: [],
    faceAngleVariation: [],
    naturalBlinkDetected: false,
    passiveLivenessScore: 0,
    passiveLivenessChecks: {
      facePresence: false,
      naturalMovement: false,
      depthVariation: false,
      sizeConsistency: false,
      angleVariation: false,
      blinkPattern: false,
    },
  });

  const capturePhoto = useCallback((gestureType: string): string => {
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!video || !captureCanvas) return "";

    const ctx = captureCanvas.getContext("2d", { alpha: false });
    if (!ctx) return "";

    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -captureCanvas.width, 0, captureCanvas.width, captureCanvas.height);
    ctx.restore();

    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 300, 60);
    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    ctx.fillText(`Gesture: ${gestureType}`, 20, 35);
    ctx.fillText(`Time: ${new Date().toLocaleTimeString()}`, 20, 55);

    const photoData = captureCanvas.toDataURL("image/jpeg", 0.8);
    return photoData;
  }, []);

  const transitionToNextStep = useCallback(
    (nextStep: GestureStep, nextStatus: string, nextProgress: number) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;
      state.isTransitioning = true;

      requestAnimationFrame(() => {
        setStep(nextStep);
        setStatus(nextStatus);
        setProgress(nextProgress);
        setTimeout(() => (state.isTransitioning = false), 100);
      });
    },
    []
  );

  const handleBlinkDetection = useCallback(
    (landmarks: FaceLandmark[]) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;

      const leftEAR = calculateSingleEyeAspectRatio(landmarks, "left");
      const rightEAR = calculateSingleEyeAspectRatio(landmarks, "right");
      const avgEAR = (leftEAR + rightEAR) / 2;

      const EYE_CLOSED_THRESHOLD = 0.22;
      const EYE_OPEN_THRESHOLD = 0.25;
      const MIN_CONSECUTIVE_FRAMES = 2;

      const eyesClosed = avgEAR < EYE_CLOSED_THRESHOLD;
      const eyesOpen = avgEAR > EYE_OPEN_THRESHOLD;

      if (eyesClosed && state.lastEyeAspectRatio > EYE_OPEN_THRESHOLD) {
        state.consecutiveFrames = 1;
        state.blinkStartTime = Date.now();
      } else if (eyesClosed && state.lastEyeAspectRatio <= EYE_OPEN_THRESHOLD) {
        state.consecutiveFrames++;
      } else if (eyesOpen && state.lastEyeAspectRatio < EYE_CLOSED_THRESHOLD && state.consecutiveFrames >= MIN_CONSECUTIVE_FRAMES) {
        const blinkDuration = Date.now() - (state.blinkStartTime || Date.now());
        if (blinkDuration >= 80 && blinkDuration <= 400) {
          state.blinkCount++;
          state.naturalBlinkDetected = true;

          if (!state.capturedPhotos.blink && state.blinkCount >= 2) {
            const photo = capturePhoto("BLINK");
            state.capturedPhotos.blink = photo;
            setCapturedCount((prev) => prev + 1);
            setPreviewPhotos((prev) => [...prev, photo]);
            setStatus("Blink verified! ✓");
            state.blinkCount = 0;

            setTimeout(() => {
              transitionToNextStep("SMILE", "Great! Now smile naturally 😊", 25);
            }, 300);
          } else {
            setStatus(`Blink detected (${state.blinkCount}/2) 👁️`);
          }
        }
        state.consecutiveFrames = 0;
        state.blinkStartTime = undefined;
      } else if (eyesOpen) {
        state.consecutiveFrames = 0;
      }

      state.lastEyeAspectRatio = avgEAR;
      if (state.blinkCount === 0 && !state.capturedPhotos.blink) {
        setStatus("Please blink your eyes twice 👁️");
      }
    },
    [capturePhoto, transitionToNextStep]
  );

  const handleSmileDetection = useCallback(
    (landmarks: FaceLandmark[]) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning || state.smileDetected) return;

      const headPose = calculateHeadPose(landmarks);
      const isHeadStraight = headPose > -0.1 && headPose < 0.1;
      const mouthOpenness = calculateMouthOpenness(landmarks);
      const isSmiling = mouthOpenness > 0.01 && mouthOpenness < 0.08;

      const validSmile = isSmiling && isHeadStraight;

      if (validSmile) {
        state.smileConsecutiveFrames++;
        if (state.smileConsecutiveFrames >= 3) {
          state.smileDetected = true;
          if (!state.capturedPhotos.smile) {
            const photo = capturePhoto("SMILE");
            state.capturedPhotos.smile = photo;
            setCapturedCount((prev) => prev + 1);
            setPreviewPhotos((prev) => [...prev, photo]);
          }
          setStatus("Smile detected! ✓");
          setTimeout(() => {
            transitionToNextStep("TURN_LEFT", "Perfect! Now turn your head left 👈", 50);
          }, 300);
        } else {
          setStatus("Smile detected... 😊");
        }
      } else {
        state.smileConsecutiveFrames = 0;
        setStatus(!isHeadStraight ? "Keep your face straight and smile 😊" : "Please smile naturally 😊");
      }

      state.lastMouthOpenness = mouthOpenness;
      state.lastSmileLandmarks = landmarks.map((l) => ({ ...l }));
    },
    [capturePhoto, transitionToNextStep]
  );

  const handleHeadTurnDetection = useCallback(
    (landmarks: FaceLandmark[], direction: "left" | "right") => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;

      const headPose = calculateHeadPose(landmarks);

      if (direction === "left" && headPose < -0.18 && !state.headTurnLeft) {
        state.headTurnLeft = true;
        if (!state.capturedPhotos.turnLeft) {
          const photo = capturePhoto("TURN_LEFT");
          state.capturedPhotos.turnLeft = photo;
          setCapturedCount((prev) => prev + 1);
          setPreviewPhotos((prev) => [...prev, photo]);
        }
        setStatus("Left turn detected! ✓");
        setTimeout(() => {
          transitionToNextStep("TURN_RIGHT", "Good! Now turn your head right 👉", 75);
        }, 500);
      } else if (direction === "right" && headPose > 0.18 && !state.headTurnRight) {
        state.headTurnRight = true;
        if (!state.capturedPhotos.turnRight) {
          const photo = capturePhoto("TURN_RIGHT");
          state.capturedPhotos.turnRight = photo;
          setCapturedCount((prev) => prev + 1);
          setPreviewPhotos((prev) => [...prev, photo]);
        }
        setProgress(100);
        setStatus("Right turn detected! ✓");
        setTimeout(() => {
          completeVerification();
        }, 500);
      }
    },
    [capturePhoto, transitionToNextStep]
  );

  const calculatePassiveLiveness = useCallback(
    (landmarks: FaceLandmark[]): number => {
      const state = detectionStateRef.current;
      const facePresence = landmarks.length > 0;
      state.passiveLivenessChecks.facePresence = facePresence;
      if (!facePresence) return 0;

      const faceSize = calculateFaceSize(landmarks);
      state.faceSizeVariation.push(faceSize);
      if (state.faceSizeVariation.length > 30) state.faceSizeVariation.shift();
      const sizeConsistency = state.faceSizeVariation.length > 10
        ? calculateVariation(state.faceSizeVariation) < 0.15
        : true;
      state.passiveLivenessChecks.sizeConsistency = sizeConsistency;

      const faceAngle = calculateFaceAngle(landmarks);
      state.faceAngleVariation.push(faceAngle);
      if (state.faceAngleVariation.length > 30) state.faceAngleVariation.shift();
      const angleVariation = state.faceAngleVariation.length > 10
        ? calculateVariation(state.faceAngleVariation) > 0.01
        : false;
      state.passiveLivenessChecks.angleVariation = angleVariation;

      if (state.lastLandmarks && state.frameCount % 3 === 0) {
        state.depthVariationScore += calculateDepthVariation(landmarks, state.lastLandmarks);
        state.motionScore += calculateMotionPattern(landmarks, state.lastLandmarks);
      }

      state.passiveLivenessChecks.depthVariation = state.depthVariationScore > 0.1;
      state.passiveLivenessChecks.naturalMovement = state.motionScore > 0.05 && state.motionScore < 2.0;
      state.passiveLivenessChecks.blinkPattern = state.naturalBlinkDetected;

      if (state.frameCount % 5 === 0) state.lastLandmarks = landmarks.map((l) => ({ ...l }));
      state.frameCount++;

      let score = 0;
      const checks = state.passiveLivenessChecks;
      if (checks.facePresence) score += 20;
      if (checks.naturalMovement) score += 20;
      if (checks.depthVariation) score += 20;
      if (checks.sizeConsistency) score += 15;
      if (checks.angleVariation) score += 15;
      if (checks.blinkPattern) score += 10;

      state.passiveLivenessScore = Math.min(score, 100);
      return state.passiveLivenessScore;
    },
    []
  );

  const completeVerification = useCallback(async () => {
    const state = detectionStateRef.current;
    setStep("COMPLETE");
    setStatus("Processing verification...");
    setIsSubmitting(true);

    const passiveScore = calculatePassiveLiveness(state.lastLandmarks || []);
    const duration = Date.now() - state.startTime;

    setPassiveLivenessResult({ score: passiveScore, checks: { ...state.passiveLivenessChecks } });
    const livenessPassed = passiveScore >= 50;

    const verificationData: VerificationResult = {
      success: livenessPassed,
      photos: state.capturedPhotos,
      confidence: Math.round(passiveScore),
      antiSpoofingScore: passiveScore,
      passiveLivenessScore: passiveScore,
      timestamp: Date.now(),
      duration,
    };

    try {
      const response = await fetch("http://localhost:3001/api/verify-liveness-with-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "demo-user-123",
          sessionId: generateSessionId(),
          verification: verificationData,
        }),
      });

      if (response.ok) {
        setStatus("✅ Verification successful! All photos submitted.");
      } else {
        setStatus("✅ Verification complete! (Backend offline - demo mode)");
      }
    } catch (err) {
      setStatus("✅ Verification complete! (Backend offline - demo mode)");
    } finally {
      setIsSubmitting(false);
    }
  }, [calculatePassiveLiveness]);

  const onResults = useCallback(
    (results: FaceMeshResults) => {
      if (!results.multiFaceLandmarks?.length) {
        setStatus("No face detected. Please position your face in the frame");
        return;
      }
      if (results.multiFaceLandmarks.length > 1) {
        setError("Multiple faces detected. Please ensure only one person is in frame.");
        return;
      }

      const landmarks = results.multiFaceLandmarks[0] as FaceLandmark[];
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas && video) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        }
      }

      switch (step) {
        case "BLINK":
          handleBlinkDetection(landmarks);
          break;
        case "SMILE":
          handleSmileDetection(landmarks);
          break;
        case "TURN_LEFT":
          handleHeadTurnDetection(landmarks, "left");
          break;
        case "TURN_RIGHT":
          handleHeadTurnDetection(landmarks, "right");
          break;
      }

      if (step !== "COMPLETE") calculatePassiveLiveness(landmarks);
    },
    [step, handleBlinkDetection, handleSmileDetection, handleHeadTurnDetection, calculatePassiveLiveness]
  );

  // Video + MediaPipe initialization...
  useEffect(() => {
    let faceMesh: FaceMeshInstance | null = null;
    let camera: CameraInstance | null = null;
    const videoElement = videoRef.current;

    const loadMediaPipe = async () => {
      try {
        if (!videoRef.current) { setError("Video element not available"); return; }

        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user", frameRate: 30 } });
        if (videoRef.current) videoRef.current.srcObject = stream;

        const faceMeshPkg = await import("@mediapipe/face_mesh");
        const cameraUtilsPkg = await import("@mediapipe/camera_utils");
        faceMesh = new (faceMeshPkg.FaceMesh || faceMeshPkg.default)({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });
        faceMesh.setOptions({ maxNumFaces: 2, refineLandmarks: true, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
        faceMesh.onResults(onResults);

        camera = new (cameraUtilsPkg.Camera || cameraUtilsPkg.default.Camera)(videoRef.current!, {
          onFrame: async () => { await faceMesh?.send({ image: videoRef.current! }); },
          width: 1280,
          height: 720,
        });
        await camera.start();
      } catch (err: unknown) { setError("Initialization error"); }
    };
    loadMediaPipe();

    return () => {
      if (camera) camera.stop();
      if (faceMesh) faceMesh.close();
      if (videoElement?.srcObject) {
        (videoElement.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [onResults]);

  return (
    <div className={styles.container}>
      <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
      <canvas ref={canvasRef} className={styles.canvas} />
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />
      <div className={styles.status}>{status}</div>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.previewPhotos}>
        {previewPhotos.map((p, i) => <img key={i} src={p} alt={`Preview ${i}`} />)}
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

// ----------------- Helper functions -----------------

function calculateSingleEyeAspectRatio(landmarks: FaceLandmark[], eye: "left" | "right") {
  const eyeIndices = eye === "left"
    ? [33, 160, 158, 133, 153, 144]
    : [362, 385, 387, 263, 373, 380];
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map(i => landmarks[i]);
  const dist = (a: FaceLandmark, b: FaceLandmark) => Math.hypot(a.x - b.x, a.y - b.y);
  return (dist(p2, p6) + dist(p3, p5)) / (2.0 * dist(p1, p4));
}

function calculateMouthOpenness(landmarks: FaceLandmark[]) {
  const topLip = landmarks[13], bottomLip = landmarks[14];
  return Math.abs(topLip.y - bottomLip.y);
}

function calculateHeadPose(landmarks: FaceLandmark[]) {
  const noseTip = landmarks[1], chin = landmarks[152];
  return (noseTip.x - chin.x) / (chin.y - noseTip.y + 1e-6);
}

function calculateFaceSize(landmarks: FaceLandmark[]) {
  const left = landmarks[234], right = landmarks[454], top = landmarks[10], bottom = landmarks[152];
  const width = Math.hypot(left.x - right.x, left.y - right.y);
  const height = Math.hypot(top.x - bottom.x, top.y - bottom.y);
  return width * height;
}

function calculateFaceAngle(landmarks: FaceLandmark[]) {
  const left = landmarks[234], right = landmarks[454];
  return Math.atan2(right.y - left.y, right.x - left.x);
}

function calculateDepthVariation(current: FaceLandmark[], previous: FaceLandmark[]) {
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    total += Math.abs(current[i].z - previous[i].z);
  }
  return total / current.length;
}

function calculateMotionPattern(current: FaceLandmark[], previous: FaceLandmark[]) {
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    total += Math.hypot(current[i].x - previous[i].x, current[i].y - previous[i].y);
  }
  return total / current.length;
}

function calculateVariation(arr: number[]) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
}

function generateSessionId() {
  return Math.random().toString(36).substr(2, 9);
}
