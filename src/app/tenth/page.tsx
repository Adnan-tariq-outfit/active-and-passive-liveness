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

type GestureStep =
  | "CAPTURE_REFERENCE"
  | "BLINK"
  | "SMILE"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "COMPLETE";

interface DetectionState {
  blinkCount: number;
  blinkStartTime?: number;
  smileDetected: boolean;
  headTurnLeft: boolean;
  headTurnRight: boolean;
  headTurnConsecutiveFrames: number;
  lastEyeAspectRatio: number;
  consecutiveFrames: number;
  smileConsecutiveFrames: number;
  lastMouthOpenness: number;
  lastSmileLandmarks: FaceLandmark[] | null;
  baselineMouthWidth?: number;
  neutralSmileFrames: number;
  capturedPhotos: {
    reference?: string;
    blink?: string;
    smile?: string;
    turnLeft?: string;
    turnRight?: string;
  };
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
  errorFrameCount: number;
  lastError: string | null;
  multipleFacesFrameCount: number;
}

interface FaceComparisonResult {
  match: boolean;
  similarity: number;
  distance: number;
  message: string;
}

interface VerificationResult {
  success: boolean;
  photos: {
    reference?: string;
    blink?: string;
    smile?: string;
    turnLeft?: string;
    turnRight?: string;
  };
  confidence: number;
  antiSpoofingScore: number;
  passiveLivenessScore: number;
  faceComparison: FaceComparisonResult | null;
  timestamp: number;
  duration: number;
}

export default function OptimizedFaceVerification() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState("Ready to start verification");
  const [step, setStep] = useState<GestureStep>("CAPTURE_REFERENCE");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);
  const [previewPhotos, setPreviewPhotos] = useState<string[]>([]);
  const [faceApiLoaded, setFaceApiLoaded] = useState(false);
  const [faceComparisonResult, setFaceComparisonResult] =
    useState<FaceComparisonResult | null>(null);
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
  const [uploadedReferenceImage, setUploadedReferenceImage] = useState<
    string | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ✅ OPTIMIZATION: Lazy load face-api.js only when needed
  const faceApiRef = useRef<typeof import("face-api.js") | null>(null);

  const detectionStateRef = useRef<DetectionState>({
    blinkCount: 0,
    smileDetected: false,
    headTurnLeft: false,
    headTurnRight: false,
    headTurnConsecutiveFrames: 0,
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
    errorFrameCount: 0,
    lastError: null,
    multipleFacesFrameCount: 0,
  });

  // ✅ OPTIMIZATION: Load face-api.js models lazily (only when verification starts)
  const loadFaceApiModels = useCallback(async () => {
    if (faceApiLoaded) return true;

    try {
      console.log("🔄 Loading face-api.js models...");
      setStatus("Loading face recognition models...");

      // Dynamic import - only loads when needed
      const faceapi = await import("face-api.js");
      faceApiRef.current = faceapi;

      const LOCAL_MODEL_URL = "/models";
      const CDN_MODEL_URL =
        "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL_MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(LOCAL_MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(LOCAL_MODEL_URL),
        ]);
        console.log("✅ Models loaded from local folder");
      } catch (localError) {
        console.warn("⚠️ Local models not found, trying CDN...");
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(CDN_MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(CDN_MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(CDN_MODEL_URL),
        ]);
        console.log("✅ Models loaded from CDN");
      }

      setFaceApiLoaded(true);
      console.log("✅ Face-api.js models ready");
      return true;
    } catch (err) {
      console.error("❌ Error loading models:", err);
      setError("Failed to load face recognition models. Please refresh.");
      return false;
    }
  }, [faceApiLoaded]);

  // Handle reference image upload from local disk
  const handleReferenceImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const imageUrl = event.target?.result as string;
          setUploadedReferenceImage(imageUrl);

          const state = detectionStateRef.current;
          state.capturedPhotos.reference = imageUrl;

          setCapturedCount(1);
          setPreviewPhotos([imageUrl]);
          setStatus(
            "Reference image uploaded! Click 'Start Verification' to begin."
          );

          console.log("📁 Reference image uploaded from disk");
        };
        reader.readAsDataURL(file);
      }
    },
    []
  );

  // Start verification process
  const startVerificationProcess = useCallback(async () => {
    if (!uploadedReferenceImage) {
      setError("Please upload a reference image first");
      return;
    }

    // ✅ Load face-api models when verification starts (not on page load)
    setStatus("Loading face recognition models...");
    const loaded = await loadFaceApiModels();

    if (!loaded) {
      setError("Failed to load face recognition models");
      return;
    }

    setStep("BLINK");
    setProgress(0);
    setStatus("Please blink your eyes twice 👁️");
    console.log("🚀 Starting liveness verification process");
  }, [uploadedReferenceImage, loadFaceApiModels]);

  // Photo capture function
  const capturePhoto = useCallback((gestureType: string): string => {
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;

    if (
      !video ||
      !captureCanvas ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return "";
    }

    const ctx = captureCanvas.getContext("2d", { alpha: false });
    if (!ctx) return "";

    if (
      captureCanvas.width !== video.videoWidth ||
      captureCanvas.height !== video.videoHeight
    ) {
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
    }

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

  // ✅ OPTIMIZATION: Run face comparison in background (non-blocking)
  const compareFaces = useCallback(
    async (
      referenceImage: string,
      compareImage: string
    ): Promise<FaceComparisonResult> => {
      try {
        console.log("🔍 Comparing faces in background...");

        if (!faceApiRef.current) {
          throw new Error("Face-api.js not loaded");
        }

        const faceapi = faceApiRef.current;

        // ✅ Run comparison in separate microtask to avoid blocking UI
        await new Promise((resolve) => setTimeout(resolve, 0));

        const img1 = await faceapi.fetchImage(referenceImage);
        const detection1 = await faceapi
          .detectSingleFace(img1, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();

        await new Promise((resolve) => setTimeout(resolve, 0));

        const img2 = await faceapi.fetchImage(compareImage);
        const detection2 = await faceapi
          .detectSingleFace(img2, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection1 || !detection2) {
          return {
            match: false,
            similarity: 0,
            distance: Infinity,
            message: "❌ Could not detect face in one or both images",
          };
        }

        const descriptor1 = detection1.descriptor;
        const descriptor2 = detection2.descriptor;

        let distance = 0;
        for (let i = 0; i < descriptor1.length; i++) {
          distance += Math.pow(descriptor1[i] - descriptor2[i], 2);
        }
        distance = Math.sqrt(distance);

        const similarity = Math.max(0, (1 - distance) * 100);
        const THRESHOLD = 0.6;
        const match = distance < THRESHOLD;

        let message = "";
        if (match) {
          if (similarity >= 85) {
            message = `✅ Same person confirmed! (${similarity.toFixed(
              1
            )}% similarity)`;
          } else if (similarity >= 70) {
            message = `✅ Likely same person (${similarity.toFixed(
              1
            )}% similarity)`;
          } else {
            message = `⚠️ Possibly same person (${similarity.toFixed(
              1
            )}% similarity)`;
          }
        } else {
          message = `❌ Different person detected (${similarity.toFixed(
            1
          )}% similarity)`;
        }

        console.log("✅ Face comparison complete:", {
          match,
          similarity: similarity.toFixed(2),
        });

        return {
          match,
          similarity: Math.round(similarity * 100) / 100,
          distance: Math.round(distance * 10000) / 10000,
          message,
        };
      } catch (err) {
        console.error("Error comparing faces:", err);
        return {
          match: false,
          similarity: 0,
          distance: Infinity,
          message: "❌ Error during face comparison",
        };
      }
    },
    []
  );

  const transitionToNextStep = useCallback(
    (nextStep: GestureStep, nextStatus: string, nextProgress: number) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;

      state.isTransitioning = true;

      requestAnimationFrame(() => {
        setProgress(nextProgress);
        setStep(nextStep);
        setStatus(nextStatus);

        setTimeout(() => {
          state.isTransitioning = false;
        }, 100);
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
      } else if (
        eyesOpen &&
        state.lastEyeAspectRatio < EYE_CLOSED_THRESHOLD &&
        state.consecutiveFrames >= MIN_CONSECUTIVE_FRAMES
      ) {
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
              transitionToNextStep(
                "SMILE",
                "Great! Now smile naturally 😊",
                25
              );
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

      state.frameCount++;

      const { mouthOpen, mouthWidth } = getMouthMetrics(landmarks);

      if (!state.baselineMouthWidth) {
        state.neutralSmileFrames++;
        state.baselineMouthWidth = (state.baselineMouthWidth || 0) + mouthWidth;

        setStatus("Relax your face 🙂");

        if (state.neutralSmileFrames >= 15) {
          state.baselineMouthWidth /= state.neutralSmileFrames;
        }
        return;
      }

      const widthIncrease =
        (mouthWidth - state.baselineMouthWidth) / state.baselineMouthWidth;
      const isSmile =
        widthIncrease > 0.12 && mouthOpen > 0.006 && mouthOpen < 0.08;

      if (isSmile) {
        state.smileConsecutiveFrames++;

        if (state.smileConsecutiveFrames >= 3) {
          state.smileDetected = true;

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

      state.lastMouthOpenness = mouthOpen;
      state.lastSmileLandmarks = landmarks.map((l) => ({ ...l }));
    },
    [capturePhoto, transitionToNextStep]
  );

  const calculatePassiveLiveness = useCallback(
    (landmarks: FaceLandmark[]): number => {
      const state = detectionStateRef.current;

      const facePresence = landmarks.length > 0;
      state.passiveLivenessChecks.facePresence = facePresence;

      if (!facePresence) {
        state.passiveLivenessScore = 0;
        return 0;
      }

      const faceSize = calculateFaceSize(landmarks);
      state.faceSizeVariation.push(faceSize);
      if (state.faceSizeVariation.length > 30) state.faceSizeVariation.shift();

      const sizeConsistency =
        state.faceSizeVariation.length > 10
          ? calculateVariation(state.faceSizeVariation) < 0.15
          : true;
      state.passiveLivenessChecks.sizeConsistency = sizeConsistency;

      const faceAngle = calculateFaceAngle(landmarks);
      state.faceAngleVariation.push(faceAngle);
      if (state.faceAngleVariation.length > 30)
        state.faceAngleVariation.shift();

      const angleVariation =
        state.faceAngleVariation.length > 10
          ? calculateVariation(state.faceAngleVariation) > 0.01
          : false;
      state.passiveLivenessChecks.angleVariation = angleVariation;

      if (state.lastLandmarks && state.frameCount % 3 === 0) {
        const depthChange = calculateDepthVariation(
          landmarks,
          state.lastLandmarks
        );
        state.depthVariationScore += depthChange;
      }
      const depthVariation = state.depthVariationScore > 0.1;
      state.passiveLivenessChecks.depthVariation = depthVariation;

      if (state.lastLandmarks && state.frameCount % 3 === 0) {
        const motion = calculateMotionPattern(landmarks, state.lastLandmarks);
        state.motionScore += motion;
      }
      const naturalMovement =
        state.motionScore > 0.05 && state.motionScore < 2.0;
      state.passiveLivenessChecks.naturalMovement = naturalMovement;

      if (state.naturalBlinkDetected) {
        state.passiveLivenessChecks.blinkPattern = true;
      }

      if (state.frameCount % 5 === 0) {
        state.lastLandmarks = landmarks.map((l) => ({ ...l }));
      }
      state.frameCount++;

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

  // ✅ OPTIMIZATION: Non-blocking verification completion
  const completeVerification = useCallback(async () => {
    const state = detectionStateRef.current;

    setStep("COMPLETE");
    setStatus("Processing verification...");
    setIsSubmitting(true);

    try {
      const passiveScore = calculatePassiveLiveness(state.lastLandmarks || []);
      const duration = Date.now() - state.startTime;

      setPassiveLivenessResult({
        score: passiveScore,
        checks: { ...state.passiveLivenessChecks },
      });

      const livenessPassed = passiveScore >= 50;

      // ✅ Show liveness results immediately
      setIsSubmitting(false);
      setStatus("Liveness check complete! Comparing faces...");

      // ✅ Run face comparison in background (non-blocking)
      let comparisonResult: FaceComparisonResult | null = null;
      if (state.capturedPhotos.reference && state.capturedPhotos.blink) {
        console.log("🔍 Starting face comparison in background...");

        // Run comparison without blocking UI
        comparisonResult = await compareFaces(
          state.capturedPhotos.reference,
          state.capturedPhotos.blink
        );
        setFaceComparisonResult(comparisonResult);
        console.log("✅ Face comparison complete");
      }

      setStatus("✅ Verification complete!");

      const verificationData: VerificationResult = {
        success: livenessPassed && (comparisonResult?.match || false),
        photos: state.capturedPhotos,
        confidence: Math.round(passiveScore),
        antiSpoofingScore: passiveScore,
        passiveLivenessScore: passiveScore,
        faceComparison: comparisonResult,
        timestamp: Date.now(),
        duration,
      };

      // ✅ Send to backend in background (non-blocking)
      fetch("http://localhost:3001/api/verify-liveness-with-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "demo-user-123",
          sessionId: generateSessionId(),
          verification: verificationData,
        }),
      })
        .then((res) => res.ok && console.log("✅ Backend updated"))
        .catch((err) => console.log("⚠️ Backend offline:", err));

      console.log("=== VERIFICATION DATA ===");
      console.log("Duration:", duration, "ms");
      console.log(
        "Liveness Score:",
        passiveScore,
        livenessPassed ? "✅ PASSED" : "❌ FAILED"
      );
      console.log("Face Comparison:", comparisonResult);
    } catch (err) {
      console.error("❌ Error during verification:", err);
      setError("Error completing verification");
      setStatus("❌ Verification failed");
      setIsSubmitting(false);
    }
  }, [calculatePassiveLiveness, compareFaces]);

  const handleHeadTurnDetection = useCallback(
    (landmarks: FaceLandmark[], direction: "left" | "right") => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;

      const headPose = calculateHeadPose(landmarks);
      const LEFT_TURN_THRESHOLD = -0.25;
      const RIGHT_TURN_THRESHOLD = 0.25;
      const MIN_CONSECUTIVE_FRAMES = 8;
      const NEUTRAL_THRESHOLD = 0.1;

      if (direction === "left") {
        if (headPose < LEFT_TURN_THRESHOLD) {
          state.headTurnConsecutiveFrames++;

          if (state.headTurnConsecutiveFrames < MIN_CONSECUTIVE_FRAMES) {
            const progress = Math.min(
              (state.headTurnConsecutiveFrames / MIN_CONSECUTIVE_FRAMES) * 100,
              90
            );
            setStatus(
              `Turn your head more right... (${Math.round(progress)}%) 👉`
            );
          }

          if (
            state.headTurnConsecutiveFrames >= MIN_CONSECUTIVE_FRAMES &&
            !state.headTurnLeft
          ) {
            state.headTurnLeft = true;

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
                "Good! Now turn your head left... 👈",
                75
              );
            }, 500);
          }
        } else if (headPose > -NEUTRAL_THRESHOLD) {
          if (state.headTurnConsecutiveFrames > 0) {
            state.headTurnConsecutiveFrames = 0;
            if (!state.headTurnLeft) {
              setStatus("Turn your head right �");
            }
          }
        }
      } else if (direction === "right") {
        if (headPose > RIGHT_TURN_THRESHOLD) {
          state.headTurnConsecutiveFrames++;

          if (state.headTurnConsecutiveFrames < MIN_CONSECUTIVE_FRAMES) {
            const progress = Math.min(
              (state.headTurnConsecutiveFrames / MIN_CONSECUTIVE_FRAMES) * 100,
              90
            );
            setStatus(
              `Turn your head more right... (${Math.round(progress)}%) 👉`
            );
          }

          if (
            state.headTurnConsecutiveFrames >= MIN_CONSECUTIVE_FRAMES &&
            !state.headTurnRight
          ) {
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
        } else if (headPose < NEUTRAL_THRESHOLD) {
          if (state.headTurnConsecutiveFrames > 0) {
            state.headTurnConsecutiveFrames = 0;
            if (!state.headTurnRight) {
              setStatus("Turn your head left... �");
            }
          }
        }
      }
    },
    [capturePhoto, transitionToNextStep, completeVerification]
  );

  const frameCounterRef = useRef(0);

  const onResults = useCallback(
    (results: FaceMeshResults) => {
      frameCounterRef.current++;
      const shouldUpdateCanvas = frameCounterRef.current % 2 === 0;

      const state = detectionStateRef.current;

      if (!results.multiFaceLandmarks?.length) {
        state.errorFrameCount++;

        if (state.errorFrameCount > 5) {
          setStatus(
            "⚠️ No face detected. Please position your face in the frame"
          );
          if (state.lastError !== "No face detected") {
            state.lastError = "No face detected";
            setError("No face detected");
          }
        }
        return;
      }

      if (results.multiFaceLandmarks.length > 1) {
        state.multipleFacesFrameCount++;
        const faceCount = results.multiFaceLandmarks.length;

        if (state.multipleFacesFrameCount >= 3) {
          const multipleFacesError = `Multiple faces detected (${faceCount} faces)`;
          setStatus(`🚫 ${faceCount} faces detected! Only 1 person allowed.`);

          if (state.lastError !== multipleFacesError) {
            state.lastError = multipleFacesError;
            setError(multipleFacesError);
          }
        }

        return;
      }

      if (state.multipleFacesFrameCount > 0) {
        state.multipleFacesFrameCount = 0;
      }

      if (state.errorFrameCount > 0 || state.lastError) {
        state.errorFrameCount = 0;
        state.lastError = null;
        setError(null);
      }

      const landmarks = results.multiFaceLandmarks[0] as FaceLandmark[];
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (
        shouldUpdateCanvas &&
        canvas &&
        video &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (ctx) {
          if (
            canvas.width !== video.videoWidth ||
            canvas.height !== video.videoHeight
          ) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        }
      }

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

      if (currentStep !== "COMPLETE" && currentStep !== "CAPTURE_REFERENCE") {
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
            setError("Camera permission denied. Please allow camera access.");
          } else if (error.name === "NotFoundError") {
            setError("No camera found. Please connect a camera.");
          } else {
            setError(
              `Camera error: ${error.message || "Please check permissions."}`
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
            maxNumFaces: 3,
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
            if (
              videoRef.current &&
              faceMesh &&
              videoRef.current.readyState >= 2
            ) {
              await faceMesh.send({ image: videoRef.current });
            }
          },
          width: 1280,
          height: 720,
        });

        if (camera) {
          await camera.start();
        }

        setStatus("Ready to start verification");
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
        <div className={styles.photoBadge}>📸 Photos: {capturedCount}/5</div>
      </div>

      <div className={styles.content}>
        <h1 className={styles.title}>Face Liveness Verification</h1>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.statusContainer}>
          <p className={styles.status}>{status}</p>
          {step !== "COMPLETE" && step !== "CAPTURE_REFERENCE" && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {step === "CAPTURE_REFERENCE" && (
          <div className={styles.captureSection}>
            <h3>Step 1: Upload Reference Photo</h3>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleReferenceImageUpload}
              className={styles.fileInput}
              id="referenceImage"
              style={{ display: "none" }}
            />
            <label htmlFor="referenceImage" className={styles.uploadButton}>
              📁 Choose Image from Disk
            </label>

            {uploadedReferenceImage && (
              <div className={styles.uploadPreview}>
                <img
                  src={uploadedReferenceImage}
                  alt="Reference"
                  className={styles.previewImage}
                />
                <p className={styles.successText}>✅ Reference image loaded!</p>
                <button
                  onClick={startVerificationProcess}
                  className={styles.startButton}
                >
                  🚀 Start Verification
                </button>
              </div>
            )}

            <p className={styles.instruction}>
              Upload a clear photo of your face. This will be compared with live
              captures.
            </p>
          </div>
        )}

        {step === "COMPLETE" && !isSubmitting && (
          <div className={styles.success}>
            <h2>✅ Verification Complete!</h2>
            <p>All checks completed</p>
            <p className={styles.photoCount}>
              📸 {capturedCount} photos captured
            </p>

            {faceComparisonResult && (
              <div className={styles.comparisonResult}>
                <h3>Face Comparison Result</h3>
                <div
                  className={`${styles.comparisonCard} ${
                    faceComparisonResult.match ? styles.match : styles.noMatch
                  }`}
                >
                  <div className={styles.comparisonMessage}>
                    {faceComparisonResult.message}
                  </div>
                  <div className={styles.comparisonDetails}>
                    <div className={styles.detailItem}>
                      <span className={styles.label}>Similarity:</span>
                      <span className={styles.value}>
                        {faceComparisonResult.similarity}%
                      </span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.label}>Distance:</span>
                      <span className={styles.value}>
                        {faceComparisonResult.distance}
                      </span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.label}>Match:</span>
                      <span className={styles.value}>
                        {faceComparisonResult.match ? "✅ Yes" : "❌ No"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.similarityBar}>
                    <div
                      className={styles.similarityFill}
                      style={{ width: `${faceComparisonResult.similarity}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            )}

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
                      <span
                        className={
                          passiveLivenessResult.checks.facePresence
                            ? styles.checkPass
                            : styles.checkFail
                        }
                      >
                        {passiveLivenessResult.checks.facePresence
                          ? "✅"
                          : "❌"}
                      </span>
                      <span>Face Presence</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span
                        className={
                          passiveLivenessResult.checks.naturalMovement
                            ? styles.checkPass
                            : styles.checkFail
                        }
                      >
                        {passiveLivenessResult.checks.naturalMovement
                          ? "✅"
                          : "❌"}
                      </span>
                      <span>Natural Movement</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span
                        className={
                          passiveLivenessResult.checks.depthVariation
                            ? styles.checkPass
                            : styles.checkFail
                        }
                      >
                        {passiveLivenessResult.checks.depthVariation
                          ? "✅"
                          : "❌"}
                      </span>
                      <span>Depth Variation (3D)</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span
                        className={
                          passiveLivenessResult.checks.sizeConsistency
                            ? styles.checkPass
                            : styles.checkFail
                        }
                      >
                        {passiveLivenessResult.checks.sizeConsistency
                          ? "✅"
                          : "❌"}
                      </span>
                      <span>Size Consistency</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span
                        className={
                          passiveLivenessResult.checks.angleVariation
                            ? styles.checkPass
                            : styles.checkFail
                        }
                      >
                        {passiveLivenessResult.checks.angleVariation
                          ? "✅"
                          : "❌"}
                      </span>
                      <span>Angle Variation</span>
                    </div>
                    <div className={styles.checkItem}>
                      <span
                        className={
                          passiveLivenessResult.checks.blinkPattern
                            ? styles.checkPass
                            : styles.checkFail
                        }
                      >
                        {passiveLivenessResult.checks.blinkPattern
                          ? "✅"
                          : "❌"}
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
            <p>Processing verification...</p>
          </div>
        )}

        <div className={styles.instructions}>
          <h3>Steps:</h3>
          <ul>
            <li
              className={
                step === "CAPTURE_REFERENCE"
                  ? styles.active
                  : detectionStateRef.current.capturedPhotos.reference
                  ? styles.completed
                  : ""
              }
            >
              📁 Upload reference photo{" "}
              {detectionStateRef.current.capturedPhotos.reference && "✓"}
            </li>
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
              😊 Smile {detectionStateRef.current.capturedPhotos.smile && "✓"}
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
                  <span className={styles.photoLabel}>
                    {index === 0 ? "Reference" : `Photo ${index}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Helper Functions */

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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

function calculateHeadPose(landmarks: FaceLandmark[]): number {
  const noseTip = landmarks[1];
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];
  const faceCenterX = (leftFaceEdge.x + rightFaceEdge.x) / 2;
  const noseOffset = noseTip.x - faceCenterX;
  const faceWidth = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
  return noseOffset / (faceWidth + 0.001);
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
  const step = 15;

  for (let i = 0; i < Math.min(current.length, previous.length); i += step) {
    const dx = current[i].x - previous[i].x;
    const dy = current[i].y - previous[i].y;
    totalMotion += Math.sqrt(dx * dx + dy * dy);
  }

  return totalMotion;
}

function calculateFaceSize(landmarks: FaceLandmark[]): number {
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];
  const topFace = landmarks[10];
  const bottomFace = landmarks[152];

  const width = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
  const height = Math.abs(topFace.y - bottomFace.y);

  return width * height;
}

function calculateFaceAngle(landmarks: FaceLandmark[]): number {
  const noseTip = landmarks[1];
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];

  const faceCenterX = (leftFaceEdge.x + rightFaceEdge.x) / 2;
  const noseOffset = noseTip.x - faceCenterX;
  const faceWidth = Math.abs(leftFaceEdge.x - rightFaceEdge.x);

  return noseOffset / (faceWidth + 0.001);
}

function calculateVariation(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length;
  const stdDev = Math.sqrt(variance);

  return mean > 0 ? stdDev / mean : 0;
}
