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

  // Smile detection stability
  smileConsecutiveFrames: number;
  lastMouthOpenness: number;
  lastSmileLandmarks: FaceLandmark[] | null;
  
  // ✅ Improved smile detection with baseline
  baselineMouthWidth?: number;
  neutralSmileFrames: number;

  // Verification timing removed

  // Photo capture
  capturedPhotos: {
    blink?: string;
    smile?: string;
    turnLeft?: string;
    turnRight?: string;
  };

  // Passive Liveness (continuous background monitoring)
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

  // Timing
  startTime: number;

  // Transition control
  isTransitioning: boolean;
}

interface VerificationResult {
  success: boolean;
  photos: {
    blink?: string;
    smile?: string;
    turnLeft?: string;
    turnRight?: string;
  };
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
  console.log(previewPhotos);

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
    baselineMouthWidth: undefined,
    neutralSmileFrames: 0,
    capturedPhotos: {},
    depthVariationScore: 0,
    motionScore: 0,
    lastLandmarks: null,
    frameCount: 0,
    startTime: Date.now(),
    isTransitioning: false,
    // Passive liveness state
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

  // Optimized photo capture with minimal blocking
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
    ctx.drawImage(
      video,
      -captureCanvas.width,
      0,
      captureCanvas.width,
      captureCanvas.height
    );
    ctx.restore();

    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(10, 10, 300, 60);
    ctx.fillStyle = "#fff";
    ctx.font = "16px Arial";
    ctx.fillText(`Gesture: ${gestureType}`, 20, 35);
    ctx.fillText(`Time: ${new Date().toLocaleTimeString()}`, 20, 55);

    const photoData = captureCanvas.toDataURL("image/jpeg", 0.8);
    console.log(`📸 Photo captured for: ${gestureType}`);

    return photoData;
  }, []);

  // Smooth transition helper
  const transitionToNextStep = useCallback(
    (nextStep: GestureStep, nextStatus: string, nextProgress: number) => {
      const state = detectionStateRef.current;

      // Prevent multiple transitions
      if (state.isTransitioning) return;

      state.isTransitioning = true;

      // Use requestAnimationFrame for smooth transition
      requestAnimationFrame(() => {
        setProgress(nextProgress);
        setStep(nextStep);
        setStatus(nextStatus);

        // Reset transition flag after a short delay
        setTimeout(() => {
          state.isTransitioning = false;
        }, 100);
      });
    },
    []
  );

  // ✅ Improved Blink Detection with Duration Check (from fifth page)
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

      // Track when eyes start closing
      if (eyesClosed && state.lastEyeAspectRatio > EYE_OPEN_THRESHOLD) {
        state.consecutiveFrames = 1;
        state.blinkStartTime = Date.now();
      } else if (eyesClosed && state.lastEyeAspectRatio <= EYE_OPEN_THRESHOLD) {
        // Eyes still closed - increment consecutive frames
        state.consecutiveFrames++;
      } else if (
        eyesOpen &&
        state.lastEyeAspectRatio < EYE_CLOSED_THRESHOLD &&
        state.consecutiveFrames >= MIN_CONSECUTIVE_FRAMES
      ) {
        // ✅ CRITICAL: Check blink duration (80-400ms for natural blink)
        const blinkDuration = Date.now() - (state.blinkStartTime || Date.now());
        if (blinkDuration >= 80 && blinkDuration <= 400) {
          // Valid natural blink detected!
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
        // Reset state after blink check
        state.consecutiveFrames = 0;
        state.blinkStartTime = undefined;
      } else if (eyesOpen) {
        state.consecutiveFrames = 0;
      }

      state.lastEyeAspectRatio = avgEAR;
      
      // Show instruction if no blinks yet
      if (state.blinkCount === 0 && !state.capturedPhotos.blink) {
        setStatus("Please blink your eyes twice 👁️");
      }
    },
    [capturePhoto, transitionToNextStep]
  );

  // ✅ Improved Smile Detection with Baseline Calibration
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

      // Get mouth metrics
      const { mouthOpen, mouthWidth } = getMouthMetrics(landmarks);

      // 2️⃣ Collect neutral baseline (first 15 frames)
      if (!state.baselineMouthWidth) {
        state.neutralSmileFrames++;
        state.baselineMouthWidth =
          (state.baselineMouthWidth || 0) + mouthWidth;

        setStatus("Relax your face 🙂");

        if (state.neutralSmileFrames >= 15) {
          state.baselineMouthWidth /= state.neutralSmileFrames;
        }
        return;
      }

      // 3️⃣ Calculate relative smile strength (compared to baseline)
      const widthIncrease =
        (mouthWidth - state.baselineMouthWidth) /
        state.baselineMouthWidth;

      // Smile detection criteria:
      // - Mouth width increased by at least 15% from baseline
      // - Mouth is slightly open (not closed, not wide open)
      const isSmile =
        widthIncrease > 0.15 &&   // mouth corners stretched
        mouthOpen > 0.008 &&      // not closed
        mouthOpen < 0.06;         // not mouth open

      if (isSmile) {
        state.smileConsecutiveFrames++;

        // Need 3 consecutive frames for stable detection
        if (state.smileConsecutiveFrames >= 3) {
          state.smileDetected = true;

          // Capture photo immediately
          if (!state.capturedPhotos.smile) {
            const photo = capturePhoto("SMILE");
            state.capturedPhotos.smile = photo;
            setCapturedCount((prev) => prev + 1);
            setPreviewPhotos((prev) => [...prev, photo]);
          }

          setStatus("Smile verified ✓");
          setTimeout(() => {
            transitionToNextStep(
              "TURN_LEFT",
              "Perfect! Now turn your head left 👈",
              50
            );
          }, 300);
        } else {
          setStatus("Nice smile… hold it 😊");
        }
      } else {
        state.smileConsecutiveFrames = 0;
        setStatus("Please smile naturally 😊");
      }

      // Update tracking values
      state.lastMouthOpenness = mouthOpen;
      state.lastSmileLandmarks = landmarks.map((l) => ({ ...l }));

      // Debug logging every 30 frames
      if (state.frameCount % 30 === 0) {
        console.log("😊 Smile Detection:", {
          baselineMouthWidth: state.baselineMouthWidth?.toFixed(4),
          currentMouthWidth: mouthWidth.toFixed(4),
          widthIncrease: (widthIncrease * 100).toFixed(1) + "%",
          mouthOpen: mouthOpen.toFixed(4),
          headPose: headPose.toFixed(3),
          consecutiveFrames: state.smileConsecutiveFrames,
          RESULT: isSmile ? "✅ SMILING" : "❌ NOT SMILING",
        });
      }
    },
    [capturePhoto, transitionToNextStep]
  );
  // Comprehensive Passive Liveness Detection (runs continuously)
  const calculatePassiveLiveness = useCallback(
    (landmarks: FaceLandmark[]): number => {
      const state = detectionStateRef.current;

      // 1. Face Presence Check
      const facePresence = landmarks.length > 0;
      state.passiveLivenessChecks.facePresence = facePresence;

      if (!facePresence) {
        state.passiveLivenessScore = 0;
        return 0;
      }

      // 2. Face Size Consistency (detects static photos)
      const faceSize = calculateFaceSize(landmarks);
      state.faceSizeVariation.push(faceSize);
      if (state.faceSizeVariation.length > 30) {
        state.faceSizeVariation.shift(); // Keep last 30 frames
      }

      const sizeConsistency = state.faceSizeVariation.length > 10
        ? calculateVariation(state.faceSizeVariation) < 0.15
        : true;
      state.passiveLivenessChecks.sizeConsistency = sizeConsistency;

      // 3. Face Angle Variation (natural head movements)
      const faceAngle = calculateFaceAngle(landmarks);
      state.faceAngleVariation.push(faceAngle);
      if (state.faceAngleVariation.length > 30) {
        state.faceAngleVariation.shift();
      }

      const angleVariation = state.faceAngleVariation.length > 10
        ? calculateVariation(state.faceAngleVariation) > 0.01
        : false;
      state.passiveLivenessChecks.angleVariation = angleVariation;

      // 4. Depth Variation (3D depth - real face indicator)
      if (state.lastLandmarks && state.frameCount % 3 === 0) {
        const depthChange = calculateDepthVariation(
          landmarks,
          state.lastLandmarks
        );
        state.depthVariationScore += depthChange;
      }
      const depthVariation = state.depthVariationScore > 0.1;
      state.passiveLivenessChecks.depthVariation = depthVariation;

      // 5. Natural Movement Pattern
      if (state.lastLandmarks && state.frameCount % 3 === 0) {
        const motion = calculateMotionPattern(landmarks, state.lastLandmarks);
        state.motionScore += motion;
      }
      const naturalMovement = state.motionScore > 0.05 && state.motionScore < 2.0;
      state.passiveLivenessChecks.naturalMovement = naturalMovement;

      // 6. Blink Pattern (natural blinking)
      if (state.naturalBlinkDetected) {
        state.passiveLivenessChecks.blinkPattern = true;
      }

      // Update landmarks
      if (state.frameCount % 5 === 0) {
        state.lastLandmarks = landmarks.map((l) => ({ ...l }));
      }
      state.frameCount++;

      // Calculate passive liveness score (0-100)
      const checks = state.passiveLivenessChecks;
      let score = 0;

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

    // Calculate final passive liveness score
    const passiveScore = calculatePassiveLiveness(state.lastLandmarks || []);
    const duration = Date.now() - state.startTime;

    // Store passive liveness result for display
    setPassiveLivenessResult({
      score: passiveScore,
      checks: { ...state.passiveLivenessChecks },
    });

    // Check if passive liveness passed (at least 50% score)
    const livenessPassed = passiveScore >= 50;

    const verificationData: VerificationResult = {
      success: livenessPassed,
      photos: state.capturedPhotos,
      confidence: Math.round(passiveScore),
      antiSpoofingScore: passiveScore, // Keep for backward compatibility
      passiveLivenessScore: passiveScore,
      timestamp: Date.now(),
      duration,
    };

    try {
      console.log("📤 Sending verification data to backend...");
      console.log("Photos captured:", Object.keys(state.capturedPhotos).length);

      const response = await fetch(
        "http://localhost:3001/api/verify-liveness-with-photos",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: "demo-user-123",
            sessionId: generateSessionId(),
            verification: verificationData,
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        console.log("✅ Backend response:", result);
        setStatus("✅ Verification successful! All photos submitted.");
      } else {
        console.warn("⚠️ Backend not available");
        setStatus("✅ Verification complete! (Backend offline - demo mode)");
      }

      console.log("=== VERIFICATION DATA ===");
      console.log("Duration:", duration, "ms");
      console.log("Passive Liveness Score:", passiveScore, livenessPassed ? "✅ PASSED" : "❌ FAILED");
      console.log("Passive Liveness Checks:", state.passiveLivenessChecks);
    } catch (err) {
      console.error("Error submitting to backend:", err);
      setStatus("✅ Verification complete! (Backend offline - demo mode)");
    } finally {
      setIsSubmitting(false);
    }
  }, [calculatePassiveLiveness]);
  // Optimized head turn detection with verification delay
  const handleHeadTurnDetection = useCallback(
    (landmarks: FaceLandmark[], direction: "left" | "right") => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;

      const headPose = calculateHeadPose(landmarks);

      if (direction === "left" && headPose < -0.18 && !state.headTurnLeft) {
        state.headTurnLeft = true;

        // Capture photo immediately
        if (!state.capturedPhotos.turnLeft) {
          const photo = capturePhoto("TURN_LEFT");
          state.capturedPhotos.turnLeft = photo;
          setCapturedCount((prev) => prev + 1);
          setPreviewPhotos((prev) => [...prev, photo]);
        }

        setStatus("Left turn detected! ✓");
        setTimeout(() => {
          transitionToNextStep(
            "TURN_RIGHT",
            "Good! Now turn your head right 👉",
            75
          );
        }, 500);
      } else if (
        direction === "left" &&
        headPose >= -0.18 &&
        state.headTurnLeft
      ) {
        // Reset if they turn back
        state.headTurnLeft = false;
        setStatus("Turn your head left 👈");
      } else if (
        direction === "right" &&
        headPose > 0.18 &&
        !state.headTurnRight
      ) {
        state.headTurnRight = true;

        // Capture photo immediately
        if (!state.capturedPhotos.turnRight) {
          const photo = capturePhoto("TURN_RIGHT");
          state.capturedPhotos.turnRight = photo;
          setCapturedCount((prev) => prev + 1);
          setPreviewPhotos((prev) => [...prev, photo]);
        }

        setProgress(100);
        setStatus("Right turn detected! ✓");

        // Complete verification
        setTimeout(() => {
          completeVerification();
        }, 500);
      } else if (
        direction === "right" &&
        headPose <= 0.18 &&
        state.headTurnRight
      ) {
        // Reset if they turn back
        state.headTurnRight = false;
        setStatus("Turn your head right 👉");
      }
    },
    [capturePhoto, transitionToNextStep, completeVerification]
  );

  // Optimized results handler
  const onResults = useCallback(
    (results: FaceMeshResults) => {
      if (!results.multiFaceLandmarks?.length) {
        setStatus("No face detected. Please position your face in the frame");
        return;
      }

      if (results.multiFaceLandmarks.length > 1) {
        setError(
          "Multiple faces detected. Please ensure only one person is in frame."
        );
        return;
      }

      const landmarks = results.multiFaceLandmarks[0] as FaceLandmark[];
      const canvas = canvasRef.current;
      const video = videoRef.current;

      // Draw to canvas (optimized)
      if (canvas && video) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

          // Face overlay removed - no green lines
        }
      }

      // Process gestures based on current step
      const currentStep = step;
      switch (currentStep) {
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

      // Passive Liveness Detection (runs continuously in background)
      if (currentStep !== "COMPLETE") {
        calculatePassiveLiveness(landmarks);
      }
    },
    [
      step,
      handleBlinkDetection,
      handleSmileDetection,
      handleHeadTurnDetection,
      calculatePassiveLiveness,
    ]
  );

  useEffect(() => {
    let faceMesh: FaceMeshInstance | null = null;
    let camera: CameraInstance | null = null;
    const videoElement = videoRef.current;

    const loadMediaPipe = async () => {
      try {
        setError(null);

        if (!videoRef.current) {
          setError("Video element not available");
          return;
        }

        if (typeof window !== "undefined") {
          const isSecure =
            window.location.protocol === "https:" ||
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1";
          if (!isSecure) {
            setError("Camera access requires HTTPS or localhost.");
            return;
          }
        }

        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: "user",
              frameRate: { ideal: 30 },
            },
          });

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await new Promise<void>((resolve) => {
              if (videoRef.current) {
                videoRef.current.onloadedmetadata = () => resolve();
              } else {
                resolve();
              }
            });
          }
        } catch (cameraErr: unknown) {
          console.error("Camera access error:", cameraErr);
          const error = cameraErr as { name?: string; message?: string };
          if (error.name === "NotAllowedError") {
            setError(
              "Camera permission denied. Please allow camera access and refresh."
            );
          } else if (error.name === "NotFoundError") {
            setError("No camera found. Please connect a camera and refresh.");
          } else {
            setError(
              `Camera error: ${
                error.message || "Please check your camera permissions."
              }`
            );
          }
          return;
        }

        const faceMeshPkg = await import("@mediapipe/face_mesh");
        const cameraUtilsPkg = await import("@mediapipe/camera_utils");

        type FaceMeshModule = {
          FaceMesh?: new (config: {
            locateFile: (file: string) => string;
          }) => FaceMeshInstance;
          default?:
            | FaceMeshModule
            | (new (config: {
                locateFile: (file: string) => string;
              }) => FaceMeshInstance);
        };

        type CameraModule = {
          Camera?: new (
            video: HTMLVideoElement,
            config: CameraConfig
          ) => CameraInstance;
          default?:
            | CameraModule
            | (new (
                video: HTMLVideoElement,
                config: CameraConfig
              ) => CameraInstance);
        };

        type FaceMeshConstructor = new (config: {
          locateFile: (file: string) => string;
        }) => FaceMeshInstance;
        type CameraConstructor = new (
          video: HTMLVideoElement,
          config: CameraConfig
        ) => CameraInstance;

        let FaceMeshClass: FaceMeshConstructor | null = null;
        const fmPkg = faceMeshPkg as unknown as FaceMeshModule;

        if (fmPkg.FaceMesh) {
          FaceMeshClass = fmPkg.FaceMesh;
        } else if (fmPkg.default) {
          const def = fmPkg.default;
          if (typeof def === "function") {
            FaceMeshClass = def as FaceMeshConstructor;
          } else if ((def as FaceMeshModule).FaceMesh) {
            FaceMeshClass = (def as FaceMeshModule).FaceMesh!;
          }
        }

        const windowFaceMesh = (
          window as unknown as { FaceMesh?: FaceMeshConstructor }
        ).FaceMesh;
        if (!FaceMeshClass && windowFaceMesh) {
          FaceMeshClass = windowFaceMesh;
        }

        if (!FaceMeshClass) {
          throw new Error("Could not find FaceMesh class");
        }

        faceMesh = new FaceMeshClass({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
          },
        });

        if (faceMesh) {
          faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7,
          });

          faceMesh.onResults(onResults);
        }

        let CameraClass: CameraConstructor | null = null;
        const cuPkg = cameraUtilsPkg as unknown as CameraModule;

        if (cuPkg.Camera) {
          CameraClass = cuPkg.Camera;
        } else if (cuPkg.default) {
          const def = cuPkg.default;
          if (typeof def === "function") {
            CameraClass = def as CameraConstructor;
          } else if ((def as CameraModule).Camera) {
            CameraClass = (def as CameraModule).Camera!;
          }
        }

        const windowCamera = (
          window as unknown as { Camera?: CameraConstructor }
        ).Camera;
        if (!CameraClass && windowCamera) {
          CameraClass = windowCamera;
        }

        if (!CameraClass) {
          throw new Error("Could not find Camera class");
        }

        camera = new CameraClass(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMesh) {
              await faceMesh.send({ image: videoRef.current });
            }
          },
          width: 1280,
          height: 720,
        });

        if (camera) {
          await camera.start();
        //   setStatus("");
        }
      } catch (err: unknown) {
        console.error("Error initializing face detection:", err);
        const error = err as { message?: string };
        setError(`Initialization error: ${error.message || "Unknown error"}`);
      }
    };

    loadMediaPipe();

    return () => {
      if (camera) {
        camera.stop();
      }
      if (faceMesh) {
        faceMesh.close();
      }
      if (videoElement?.srcObject) {
        const stream = videoElement.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoElement.srcObject = null;
      }
    };
  }, [onResults]);

  return (
    <div className={styles.container}>
      <div className={styles.videoContainer}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={styles.video}
        />
        <canvas ref={canvasRef} className={styles.canvas} />

        <canvas ref={captureCanvasRef} style={{ display: "none" }} />

        <div className={styles.photoBadge}>📸 Photos: {capturedCount}/4</div>
      </div>

      <div className={styles.content}>
        <h1 className={styles.title}>Face Liveness Verification</h1>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.statusContainer}>
          <p className={styles.status}>{status}</p>
          {step !== "COMPLETE" && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {step === "COMPLETE" && !isSubmitting && (
          <div className={styles.success}>
            <h2>✅ Verification Complete!</h2>
            <p>All photos captured and submitted</p>
            <p className={styles.photoCount}>
              📸 {capturedCount} photos sent to backend
            </p>
            
            {/* Passive Liveness Result */}
            {passiveLivenessResult && (
              <div className={styles.livenessResult}>
                <h3>Passive Liveness Analysis</h3>
                <div className={styles.livenessScore}>
                  <div className={styles.scoreCircle}>
                    <span className={styles.scoreValue}>
                      {passiveLivenessResult.score}
                    </span>
                    <span className={styles.scoreLabel}>/ 100</span>
                  </div>
                  <div className={styles.scoreStatus}>
                    {passiveLivenessResult.score >= 50 ? (
                      <span className={styles.passed}>✅ PASSED</span>
                    ) : (
                      <span className={styles.failed}>❌ FAILED</span>
                    )}
                  </div>
                </div>
                
                <div className={styles.livenessChecks}>
                  <h4>Liveness Checks:</h4>
                  <div className={styles.checkList}>
                    <div className={styles.checkItem}>
                      <span className={passiveLivenessResult.checks.facePresence ? styles.checkPass : styles.checkFail}>
                        {passiveLivenessResult.checks.facePresence ? "✅" : "❌"}
                      </span>
                      <span>Face Presence</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span className={passiveLivenessResult.checks.naturalMovement ? styles.checkPass : styles.checkFail}>
                        {passiveLivenessResult.checks.naturalMovement ? "✅" : "❌"}
                      </span>
                      <span>Natural Movement</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span className={passiveLivenessResult.checks.depthVariation ? styles.checkPass : styles.checkFail}>
                        {passiveLivenessResult.checks.depthVariation ? "✅" : "❌"}
                      </span>
                      <span>Depth Variation (3D)</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span className={passiveLivenessResult.checks.sizeConsistency ? styles.checkPass : styles.checkFail}>
                        {passiveLivenessResult.checks.sizeConsistency ? "✅" : "❌"}
                      </span>
                      <span>Size Consistency</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span className={passiveLivenessResult.checks.angleVariation ? styles.checkPass : styles.checkFail}>
                        {passiveLivenessResult.checks.angleVariation ? "✅" : "❌"}
                      </span>
                      <span>Angle Variation</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span className={passiveLivenessResult.checks.blinkPattern ? styles.checkPass : styles.checkFail}>
                        {passiveLivenessResult.checks.blinkPattern ? "✅" : "❌"}
                      </span>
                      <span>Blink Pattern</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {isSubmitting && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>Submitting verification data...</p>
          </div>
        )}

        <div className={styles.instructions}>
          <h3>Complete these gestures:</h3>
          <ul>
            <li
              className={
                step === "BLINK"
                  ? styles.active
                  : detectionStateRef.current.capturedPhotos.blink
                  ? styles.completed
                  : ""
              }
            >
              👁️ Blink twice{" "}
              {detectionStateRef.current.capturedPhotos.blink && "✓"}
            </li>
            <li
              className={
                step === "SMILE"
                  ? styles.active
                  : detectionStateRef.current.capturedPhotos.smile
                  ? styles.completed
                  : ""
              }
            >
              😊 Smile naturally{" "}
              {detectionStateRef.current.capturedPhotos.smile && "✓"}
            </li>
            <li
              className={
                step === "TURN_LEFT"
                  ? styles.active
                  : detectionStateRef.current.capturedPhotos.turnLeft
                  ? styles.completed
                  : ""
              }
            >
              👉 Turn right{" "}
              {detectionStateRef.current.capturedPhotos.turnLeft && "✓"}
            </li>
            <li
              className={
                step === "TURN_RIGHT"
                  ? styles.active
                  : detectionStateRef.current.capturedPhotos.turnRight
                  ? styles.completed
                  : ""
              }
            >
              👈 Turn left{" "}
              {detectionStateRef.current.capturedPhotos.turnRight && "✓"}
            </li>
          </ul>
        </div>

        {previewPhotos.length > 0 && (
          <div className={styles.photoPreview}>
            <h3>Captured Photos:</h3>
            <div className={styles.photoGrid}>
              {previewPhotos.map((photo, index) => (
                <div key={index} className={styles.photoItem}>
                  <img src={photo} alt={`Captured ${index + 1}`} />
                  <span className={styles.photoLabel}>Photo {index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Helper Functions ---------------- */

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// drawFaceOverlay function removed - no green lines on face

function calculateSingleEyeAspectRatio(
  landmarks: FaceLandmark[],
  eye: "left" | "right"
): number {
  let top, bottom, left, right;

  if (eye === "left") {
    top = landmarks[159];
    bottom = landmarks[145];
    left = landmarks[33];
    right = landmarks[133];
  } else {
    top = landmarks[386];
    bottom = landmarks[374];
    left = landmarks[362];
    right = landmarks[263];
  }

  const vertical = Math.abs(top.y - bottom.y);
  const horizontal = Math.abs(left.x - right.x);
  return vertical / (horizontal + 0.001);
}

// Unused helper functions removed - smile detection now uses inline calculations

function calculateHeadPose(landmarks: FaceLandmark[]): number {
  const noseTip = landmarks[1];
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];
  const faceCenterX = (leftFaceEdge.x + rightFaceEdge.x) / 2;
  const noseOffset = noseTip.x - faceCenterX;
  const faceWidth = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
  return noseOffset / (faceWidth + 0.001);
}

// ✅ Improved mouth metrics function for baseline-based smile detection
function getMouthMetrics(landmarks: FaceLandmark[]) {
  const topLip = landmarks[13];
  const bottomLip = landmarks[14];
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];

  const mouthOpen = Math.abs(topLip.y - bottomLip.y);
  const mouthWidth = Math.abs(leftCorner.x - rightCorner.x);

  return { mouthOpen, mouthWidth };
}

function calculateDepthVariation(
  current: FaceLandmark[],
  previous: FaceLandmark[]
): number {
  let depthChange = 0;
  const checkPoints = [1, 33, 61, 199, 263, 291];

  for (const idx of checkPoints) {
    const zDiff = Math.abs((current[idx].z || 0) - (previous[idx].z || 0));
    depthChange += zDiff;
  }

  return depthChange / checkPoints.length;
}

function calculateMotionPattern(
  current: FaceLandmark[],
  previous: FaceLandmark[]
): number {
  let totalMotion = 0;
  const step = 15; // Check fewer points for performance

  for (let i = 0; i < Math.min(current.length, previous.length); i += step) {
    const dx = current[i].x - previous[i].x;
    const dy = current[i].y - previous[i].y;
    totalMotion += Math.sqrt(dx * dx + dy * dy);
  }

  return totalMotion;
}

// Passive Liveness Helper Functions

function calculateFaceSize(landmarks: FaceLandmark[]): number {
  // Calculate face size using key facial points
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];
  const topFace = landmarks[10];
  const bottomFace = landmarks[152];

  const width = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
  const height = Math.abs(topFace.y - bottomFace.y);
  
  // Return normalized face area
  return width * height;
}

function calculateFaceAngle(landmarks: FaceLandmark[]): number {
  // Calculate face angle using nose and face edges
  const noseTip = landmarks[1];
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];
  
  // Calculate angle based on nose position relative to face center
  const faceCenterX = (leftFaceEdge.x + rightFaceEdge.x) / 2;
  const noseOffset = noseTip.x - faceCenterX;
  const faceWidth = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
  
  // Return normalized angle
  return noseOffset / (faceWidth + 0.001);
}

function calculateVariation(values: number[]): number {
  // Calculate coefficient of variation (standard deviation / mean)
  if (values.length === 0) return 0;
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  return mean > 0 ? stdDev / mean : 0;
}
