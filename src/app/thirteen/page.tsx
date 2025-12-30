"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./page.module.css";
import type {
  FaceMeshInstance,
  FaceMeshResults,
  CameraInstance,
  CameraConfig,
  FaceLandmark,
} from "@/types/mediapipe";

type VerificationStep =
  | "READY"
  | "BLINK"
  | "SMILE"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "SHOW_NUMBER"
  | "RECORDING_AUDIO"
  | "PROCESSING"
  | "COMPLETE";

interface DetectionState {
  faceDetected: boolean;
  faceDetectedFrames: number;
  noFaceFrames: number;
  multipleFacesFrames: number;
  startTime: number;
  frameCount: number;
  videoFrames: string[]; // Frames captured during recording
  // Blink detection
  blinkCount: number;
  lastEyeAspectRatio: number;
  consecutiveFrames: number;
  blinkStartTime?: number;
  blinkDetected: boolean;
  // Head turn detection
  headTurnLeft: boolean;
  headTurnRight: boolean;
  headTurnConsecutiveFrames: number;
  // Smile detection
  smileDetected: boolean;
  smileConsecutiveFrames: number;
  lastMouthOpenness: number;
  baselineMouthWidth?: number;
  neutralSmileFrames: number;
  lastLandmarks: FaceLandmark[] | null;
  isTransitioning: boolean;
  audioRecordingStarted: boolean; // Prevent showing number again
  // 3D Liveness Detection
  depthVariationScore: number;
  depthVariationFrames: number;
  previousDepthValues: number[];
  liveness3DScore: number;
  liveness3DDetected: boolean;
  // Enhanced Detection Properties
  depthVariationHistory: number[];
  zeroVariationFrames: number;
  flatDepthFrames: number;
  videoDetected: boolean;
  image2DDetected: boolean;
}

interface VerificationResult {
  success: boolean;
  randomNumber: string;
  videoBlob: Blob | null;
  audioBlob: Blob | null;
  videoFrames: string[];
  gestures: {
    blinkDetected: boolean;
    smileDetected: boolean;
    headTurnLeft: boolean;
    headTurnRight: boolean;
  };
  numberValidation: {
    validated: boolean;
    spokenNumber?: string;
  };
  liveness3D: {
    detected: boolean;
    score: number;
    depthVariation: number;
    confidence: number;
    videoDetected: boolean;
    image2DDetected: boolean;
  };
  timestamp: number;
  duration: number;
}

export default function VideoIdentification() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopVideoRecordingRef = useRef<(() => void) | undefined>(undefined);
  const startAudioRecordingRef = useRef<(() => void) | undefined>(undefined);
  const completeVerificationRef = useRef<(() => Promise<void>) | undefined>(
    undefined
  );
  const sendToBackendRef = useRef<
    ((result: VerificationResult) => Promise<void>) | undefined
  >(undefined);
  const startVideoRecordingRef = useRef<
    ((stream: MediaStream) => void) | undefined
  >(undefined);

  const [status, setStatus] = useState("Ready to start video identification");
  const [step, setStep] = useState<VerificationStep>("READY");
  const [error, setError] = useState<string | null>(null);
  const [randomNumber, setRandomNumber] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [verificationResult, setVerificationResult] =
    useState<VerificationResult | null>(null);
  const [spokenNumber, setSpokenNumber] = useState<string>("");
  const [numberValidated, setNumberValidated] = useState(false);
  const [previewFrames, setPreviewFrames] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement>(null);

  const detectionStateRef = useRef<DetectionState>({
    faceDetected: false,
    faceDetectedFrames: 0,
    noFaceFrames: 0,
    multipleFacesFrames: 0,
    startTime: Date.now(),
    frameCount: 0,
    videoFrames: [],
    blinkCount: 0,
    lastEyeAspectRatio: 0.3,
    consecutiveFrames: 0,
    blinkDetected: false,
    headTurnLeft: false,
    headTurnRight: false,
    headTurnConsecutiveFrames: 0,
    smileDetected: false,
    smileConsecutiveFrames: 0,
    lastMouthOpenness: 0,
    neutralSmileFrames: 0,
    lastLandmarks: null,
    isTransitioning: false,
    audioRecordingStarted: false,
    // 3D Liveness state
    depthVariationScore: 0,
    depthVariationFrames: 0,
    previousDepthValues: [],
    liveness3DScore: 0,
    liveness3DDetected: false,
    // Enhanced Detection state
    depthVariationHistory: [],
    zeroVariationFrames: 0,
    flatDepthFrames: 0,
    videoDetected: false,
    image2DDetected: false,
  });

  const audioStreamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null); // SpeechRecognition API

  // Helper function: Calculate single eye aspect ratio
  const calculateSingleEyeAspectRatio = useCallback(
    (landmarks: FaceLandmark[], eye: "left" | "right"): number => {
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
    },
    []
  );

  // Helper function: Calculate head pose
  const calculateHeadPose = useCallback((landmarks: FaceLandmark[]): number => {
    const noseTip = landmarks[1];
    const leftFaceEdge = landmarks[234];
    const rightFaceEdge = landmarks[454];
    const faceCenterX = (leftFaceEdge.x + rightFaceEdge.x) / 2;
    const noseOffset = noseTip.x - faceCenterX;
    const faceWidth = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
    return noseOffset / (faceWidth + 0.001);
  }, []);

  // Efficient 3D Liveness Detection Function with Enhanced 2D/Video Detection
  const calculate3DLiveness = useCallback(
    (landmarks: FaceLandmark[]): {
      detected: boolean;
      score: number;
      depthVariation: number;
      confidence: number;
      videoDetected: boolean;
      image2DDetected: boolean;
    } => {
      const state = detectionStateRef.current;

      // Key face points for depth measurement (strategically selected)
      const depthCheckPoints = [
        1,    // Forehead center
        33,   // Nose tip
        61,   // Left eye corner
        199,  // Right eye corner
        263,  // Left cheek
        291,  // Right cheek
        10,   // Upper forehead
        152,  // Chin center
      ];

      // Calculate current depth values
      const currentDepths: number[] = [];
      let validPoints = 0;

      for (const idx of depthCheckPoints) {
        const landmark = landmarks[idx];
        if (landmark && landmark.z !== undefined && landmark.z !== null) {
          currentDepths.push(landmark.z);
          validPoints++;
        }
      }

      // Need at least 4 valid points for reliable measurement
      if (validPoints < 4) {
        return {
          detected: false,
          score: 0,
          depthVariation: 0,
          confidence: 0,
          videoDetected: false,
          image2DDetected: false,
        };
      }

      // Calculate depth variation if we have previous values
      let depthVariation = 0;
      if (state.previousDepthValues.length > 0) {
        let totalVariation = 0;
        const minLength = Math.min(
          currentDepths.length,
          state.previousDepthValues.length
        );

        for (let i = 0; i < minLength; i++) {
          const variation = Math.abs(
            currentDepths[i] - state.previousDepthValues[i]
          );
          totalVariation += variation;
        }

        depthVariation = totalVariation / minLength;
        state.depthVariationScore += depthVariation;
        state.depthVariationFrames++;

        // ✅ Store depth variation history for pattern analysis
        state.depthVariationHistory.push(depthVariation);
        if (state.depthVariationHistory.length > 20) {
          state.depthVariationHistory.shift(); // Keep last 20 values
        }

        // ✅ IMPROVEMENT 1: Enhanced 2D Image Detection
        // Check 1: Zero or very low depth variation (static photo)
        if (depthVariation < 0.005) {
          // More strict threshold - only truly zero variation
          state.zeroVariationFrames++;
        } else {
          // If there's any movement, decrease counter faster
          state.zeroVariationFrames = Math.max(0, state.zeroVariationFrames - 2);
          // If significant movement detected, reset 2D detection
          if (depthVariation > 0.05 && state.image2DDetected) {
            state.image2DDetected = false; // Real movement detected, not 2D
          }
        }
      }

      // Store current depths for next frame (synchronized update)
      state.previousDepthValues = [...currentDepths];

      // Calculate depth consistency (variance in current frame)
      const meanDepth =
        currentDepths.reduce((sum, d) => sum + d, 0) / currentDepths.length;
      const variance =
        currentDepths.reduce(
          (sum, d) => sum + Math.pow(d - meanDepth, 2),
          0
        ) / currentDepths.length;
      const depthConsistency = Math.sqrt(variance);

      // ✅ IMPROVEMENT 2: Check for flat depth structure (2D image characteristic)
      const depthRange = Math.max(...currentDepths) - Math.min(...currentDepths);
      if (depthRange < 0.03) {
        // More strict threshold - only very flat structures
        state.flatDepthFrames++;
      } else {
        state.flatDepthFrames = Math.max(0, state.flatDepthFrames - 2); // Decrease faster
      }

      // ✅ IMPROVEMENT 3-5: Enhanced 2D Detection - Require MULTIPLE conditions
      // Only flag as 2D if ALL of these are true simultaneously:
      // 1. Very low depth consistency (extremely flat)
      // 2. Very narrow depth range (no 3D structure)
      // 3. Zero or near-zero variation for extended period
      // 4. Enough frames analyzed (at least 20 frames)
      // 5. No significant movement detected overall

      const hasVeryLowConsistency = depthConsistency < 0.003; // More strict (was 0.005)
      const hasVeryNarrowRange = depthRange < 0.02; // More strict (was 0.03)
      const hasExtendedZeroVariation = state.zeroVariationFrames > 20; // More frames required (was 10)
      const hasExtendedFlatStructure = state.flatDepthFrames > 20; // More frames required (was 10)
      const hasEnoughAnalysisFrames = state.depthVariationFrames >= 20; // Need more data
      const hasNoSignificantMovement = state.depthVariationScore < 0.1; // Overall very low movement

      // Only flag as 2D if MULTIPLE strong indicators are present
      // This prevents false positives on real faces that are temporarily still
      if (
        hasEnoughAnalysisFrames &&
        hasNoSignificantMovement &&
        (
          // Option 1: Very flat structure + zero variation
          (hasVeryLowConsistency && hasVeryNarrowRange && hasExtendedZeroVariation) ||
          // Option 2: Extended flat structure + extended zero variation
          (hasExtendedFlatStructure && hasExtendedZeroVariation && hasVeryNarrowRange)
        )
      ) {
        state.image2DDetected = true;
      }

      // ✅ IMPROVEMENT 6: Video Playback Detection - Movement Pattern Analysis
      // Only flag as video if MULTIPLE strong indicators are present
      // This prevents false positives on real faces with smooth movement
      
      let videoIndicators = 0; // Count how many indicators suggest video
      const minFramesForVideoCheck = 25; // Need more frames to be confident
      
      if (state.depthVariationHistory.length >= 15) {
        const recentVariations = state.depthVariationHistory.slice(-15);
        const mean = recentVariations.reduce((a, b) => a + b, 0) / recentVariations.length;
        const variance = recentVariations.reduce(
          (sum, v) => sum + Math.pow(v - mean, 2),
          0
        ) / recentVariations.length;
        const stdDev = Math.sqrt(variance);

        // Video has EXTREMELY predictable patterns (very low standard deviation)
        // Real faces can have low std dev when moving smoothly, so make threshold stricter
        if (stdDev < 0.015 && state.depthVariationFrames > minFramesForVideoCheck) {
          videoIndicators++;
        }

        // Video has uniform variation (very small range but consistent)
        const maxVar = Math.max(...recentVariations);
        const minVar = Math.min(...recentVariations);
        const variationRange = maxVar - minVar;

        // More strict: require very small range AND consistent mean
        if (variationRange < 0.05 && mean > 0.03 && state.depthVariationFrames > minFramesForVideoCheck) {
          videoIndicators++;
        }
        
        // Check for unnatural uniformity - all variations very similar
        const allSimilar = recentVariations.every(v => Math.abs(v - mean) < 0.01);
        if (allSimilar && state.depthVariationFrames > minFramesForVideoCheck) {
          videoIndicators++;
        }
      }

      // ✅ IMPROVEMENT 7: Frame-to-Frame Consistency Check (Video characteristic)
      if (state.previousDepthValues.length > 0 && currentDepths.length > 0) {
        let totalDiff = 0;
        const minLen = Math.min(currentDepths.length, state.previousDepthValues.length);
        for (let i = 0; i < minLen; i++) {
          totalDiff += Math.abs(currentDepths[i] - state.previousDepthValues[i]);
        }
        const avgDiff = totalDiff / minLen;

        // EXTREMELY low difference = high consistency (video characteristic)
        // Real faces have more natural variation, even when still
        // Make threshold much stricter
        if (avgDiff < 0.005 && state.depthVariationFrames > minFramesForVideoCheck) {
          videoIndicators++;
        }
      }
      
      // Only flag as video if MULTIPLE indicators AND enough frames analyzed
      // Also check that there's no natural variation that would indicate real face
      const hasNaturalVariation = state.depthVariationScore > 0.2 || depthVariation > 0.03;
      const hasEnoughFramesForVideo = state.depthVariationFrames >= minFramesForVideoCheck;
      
      // Require at least 2-3 indicators to be confident it's video
      // AND no significant natural variation detected
      if (hasEnoughFramesForVideo && videoIndicators >= 2 && !hasNaturalVariation) {
        state.videoDetected = true;
      } else if (hasNaturalVariation && state.videoDetected) {
        // If natural variation detected, reset video detection
        state.videoDetected = false;
      }

      // Accumulate depth variation score (reset if too high to prevent stale data)
      if (state.depthVariationScore > 5.0) {
        state.depthVariationScore = 0.5; // Reset to baseline
      }

      // Calculate 3D liveness score (0-100)
      // Real face should have:
      // 1. Depth variation > threshold (movement detected)
      // 2. Consistent depth structure (not flat like photo)
      // 3. Multiple frames with variation

      const hasDepthVariation = state.depthVariationScore > 0.15;
      const hasConsistentStructure = depthConsistency > 0.01 && depthConsistency < 0.3;
      const hasEnoughFrames = state.depthVariationFrames >= 5;

      let score = 0;
      if (hasDepthVariation) score += 40;
      if (hasConsistentStructure) score += 30;
      if (hasEnoughFrames) score += 30;

      // ✅ Apply penalties for detected spoofs
      // Only apply penalty if we're very confident it's a spoof
      // Check if there's any movement that suggests it's real
      const hasAnyRealMovement = state.depthVariationScore > 0.1 || depthVariation > 0.02;
      
      if (state.image2DDetected && !hasAnyRealMovement) {
        // Only penalize if no real movement detected
        score = Math.max(0, score - 60); // Heavy penalty for 2D image
      } else if (state.image2DDetected && hasAnyRealMovement) {
        // If 2D detected but movement found, might be false positive - reset it
        state.image2DDetected = false;
      }
      
      if (state.videoDetected) {
        score = Math.max(0, score - 50); // Heavy penalty for video playback
      }

      // Confidence based on consistency and frame count
      const confidence = Math.min(
        100,
        (state.depthVariationFrames / 10) * 50 + (hasConsistentStructure ? 50 : 0)
      );

      // ✅ Final detection must pass all checks and not be spoofed
      const detected =
        score >= 60 &&
        hasDepthVariation &&
        hasEnoughFrames &&
        !state.image2DDetected &&
        !state.videoDetected;

      // Update state
      state.liveness3DScore = score;
      state.liveness3DDetected = detected;

      return {
        detected,
        score: Math.round(score),
        depthVariation: Math.round(state.depthVariationScore * 1000) / 1000,
        confidence: Math.round(confidence),
        videoDetected: state.videoDetected,
        image2DDetected: state.image2DDetected,
      };
    },
    []
  );

  // Helper function: Get mouth metrics
  const getMouthMetrics = useCallback((landmarks: FaceLandmark[]) => {
    const topLip = landmarks[13];
    const bottomLip = landmarks[14];
    const leftCorner = landmarks[61];
    const rightCorner = landmarks[291];

    const mouthOpen = Math.abs(topLip.y - bottomLip.y);
    const mouthWidth = Math.abs(leftCorner.x - rightCorner.x);

    return { mouthOpen, mouthWidth };
  }, []);

  // Transition to next step
  const transitionToNextStep = useCallback(
    (nextStep: VerificationStep, nextStatus: string) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning) return;

      state.isTransitioning = true;

      requestAnimationFrame(() => {
        setStep(nextStep);
        setStatus(nextStatus);

        setTimeout(() => {
          state.isTransitioning = false;
        }, 100);
      });
    },
    []
  );

  // Capture frame from video during recording
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (
      !video ||
      !canvas ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return null;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  // Blink detection
  const handleBlinkDetection = useCallback(
    (landmarks: FaceLandmark[]) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning || state.blinkDetected) return;

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
          state.blinkDetected = true;

          // Capture frame when blink is detected
          const frame = captureFrame();
          if (frame && !state.videoFrames[0]) {
            state.videoFrames[0] = frame; // Frame 1: Blink
            setPreviewFrames((prev) => {
              const newFrames = [...prev];
              newFrames[0] = frame;
              return newFrames;
            });
            console.log("📸 Frame 1 captured: Blink detected");
          }

          setStatus("Blink detected! ✓");
          setTimeout(() => {
            transitionToNextStep("SMILE", "Now please smile 😊");
          }, 500);
        }
        state.consecutiveFrames = 0;
        state.blinkStartTime = undefined;
      } else if (eyesOpen) {
        state.consecutiveFrames = 0;
      }

      state.lastEyeAspectRatio = avgEAR;

      if (state.blinkCount === 0 && !state.blinkDetected) {
        setStatus("Please blink your eyes 👁️");
      }
    },
    [calculateSingleEyeAspectRatio, transitionToNextStep, captureFrame]
  );

  // Head turn detection
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
              `Turn your head more left... (${Math.round(progress)}%) 👈`
            );
          }

          if (
            state.headTurnConsecutiveFrames >= MIN_CONSECUTIVE_FRAMES &&
            !state.headTurnLeft
          ) {
            state.headTurnLeft = true;

            // Capture frame when head turn left is detected
            const frame = captureFrame();
            if (frame && !state.videoFrames[2]) {
              state.videoFrames[2] = frame; // Frame 3: Head Turn Left
              setPreviewFrames((prev) => {
                const newFrames = [...prev];
                newFrames[2] = frame;
                return newFrames;
              });
              console.log("📸 Frame 3 captured: Head turn left detected");
            }

            setStatus("Left turn detected! ✓");
            setTimeout(() => {
              transitionToNextStep("TURN_RIGHT", "Now turn your head right 👉");
            }, 500);
          }
        } else if (headPose > -NEUTRAL_THRESHOLD) {
          if (state.headTurnConsecutiveFrames > 0) {
            state.headTurnConsecutiveFrames = 0;
            if (!state.headTurnLeft) {
              setStatus("Turn your head left 👈");
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

            // Capture frame when head turn right is detected
            const frame = captureFrame();
            if (frame && !state.videoFrames[3]) {
              state.videoFrames[3] = frame; // Frame 4: Head Turn Right
              setPreviewFrames((prev) => {
                const newFrames = [...prev];
                newFrames[3] = frame;
                return newFrames;
              });
              console.log("📸 Frame 4 captured: Head turn right detected");
            }

            setStatus("Right turn detected! ✓");
            // All gestures complete - show random number, then start audio
            // Video continues recording
            setTimeout(() => {
              setStep("SHOW_NUMBER");
              setStatus(
                `All gestures complete! Now read this number: ${randomNumber}`
              );

              // Show number for 3 seconds, then start audio recording
              // Video continues recording during audio too
              setTimeout(() => {
                if (startAudioRecordingRef.current) {
                  startAudioRecordingRef.current();
                }
              }, 3000);
            }, 500);
          }
        } else if (headPose < NEUTRAL_THRESHOLD) {
          if (state.headTurnConsecutiveFrames > 0) {
            state.headTurnConsecutiveFrames = 0;
            if (!state.headTurnRight) {
              setStatus("Turn your head right 👉");
            }
          }
        }
      }
    },
    [calculateHeadPose, transitionToNextStep, randomNumber, captureFrame]
  );

  // Smile detection
  const handleSmileDetection = useCallback(
    (landmarks: FaceLandmark[]) => {
      const state = detectionStateRef.current;
      if (state.isTransitioning || state.smileDetected) return;

      state.frameCount++;

      // Get mouth metrics
      const { mouthOpen, mouthWidth } = getMouthMetrics(landmarks);

      // Collect neutral baseline (first 15 frames)
      if (!state.baselineMouthWidth) {
        state.neutralSmileFrames++;
        state.baselineMouthWidth = (state.baselineMouthWidth || 0) + mouthWidth;

        setStatus("Relax your face 🙂");

        if (state.neutralSmileFrames >= 15) {
          state.baselineMouthWidth /= state.neutralSmileFrames;
        }
        return;
      }

      // Calculate relative smile strength (compared to baseline)
      const widthIncrease =
        (mouthWidth - state.baselineMouthWidth) / state.baselineMouthWidth;

      // Smile detection criteria
      const isSmile =
        widthIncrease > 0.12 && mouthOpen > 0.006 && mouthOpen < 0.08;

      if (isSmile) {
        state.smileConsecutiveFrames++;

        // Need 3 consecutive frames for stable detection
        if (state.smileConsecutiveFrames >= 3) {
          state.smileDetected = true;

          // Capture frame when smile is detected
          const frame = captureFrame();
          if (frame && !state.videoFrames[1]) {
            state.videoFrames[1] = frame; // Frame 2: Smile
            setPreviewFrames((prev) => {
              const newFrames = [...prev];
              newFrames[1] = frame;
              return newFrames;
            });
            console.log("📸 Frame 2 captured: Smile detected");
          }

          setStatus("Smile detected! ✓");
          setTimeout(() => {
            transitionToNextStep("TURN_LEFT", "Now turn your head left 👈");
          }, 500);
        } else {
          setStatus("Nice smile… hold it 😊");
        }
      } else {
        state.smileConsecutiveFrames = 0;
        setStatus("Please smile naturally 😊");
      }

      // Update tracking values
      state.lastMouthOpenness = mouthOpen;
    },
    [getMouthMetrics, transitionToNextStep, captureFrame]
  );

  // Generate random 5-digit number
  const generateRandomNumber = useCallback((): string => {
    let number = "";
    for (let i = 0; i < 5; i++) {
      number += Math.floor(Math.random() * 10).toString();
    }
    return number;
  }, []);

  // Start video identification process
  const startIdentification = useCallback(async () => {
    try {
      setError(null);
      setStatus("Requesting camera and microphone access...");

      // Request both video and audio separately to keep them independent
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
          frameRate: { ideal: 30 },
        },
      });

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        },
      });

      // Combine streams for video element
      const combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioStream.getAudioTracks(),
      ]);

      streamRef.current = combinedStream;
      audioStreamRef.current = audioStream;

      if (videoRef.current) {
        videoRef.current.srcObject = combinedStream;
        await new Promise<void>((resolve) => {
          if (videoRef.current) {
            videoRef.current.onloadedmetadata = () => resolve();
          } else {
            resolve();
          }
        });
      }

      // Generate random 5-digit number (will show after gestures)
      const number = generateRandomNumber();
      setRandomNumber(number);

      // Start directly with video recording (30 seconds total)
      setStatus("Position your face in the frame");
      if (startVideoRecordingRef.current) {
        startVideoRecordingRef.current(videoStream);
      }
    } catch (err: unknown) {
      console.error("Error starting identification:", err);
      const error = err as { name?: string; message?: string };
      if (error.name === "NotAllowedError") {
        setError("Camera/Microphone permission denied. Please allow access.");
      } else if (error.name === "NotFoundError") {
        setError("No camera/microphone found. Please connect devices.");
      } else {
        setError(`Error: ${error.message || "Please check permissions."}`);
      }
    }
  }, [generateRandomNumber]);

  // Start video recording
  const startVideoRecording = useCallback((stream: MediaStream) => {
    try {
      const videoTrack = stream.getVideoTracks()[0];
      const videoStream = new MediaStream([videoTrack]);

      const mediaRecorder = new MediaRecorder(videoStream, {
        mimeType: "video/webm;codecs=vp8",
      });

      videoChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log("✅ Video recording stopped");
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // Collect data every 100ms for better quality

      detectionStateRef.current.startTime = Date.now();
        detectionStateRef.current.videoFrames = []; // Reset frames array
        setPreviewFrames([]); // Reset preview frames
        
        // Reset 3D liveness state
        detectionStateRef.current.depthVariationScore = 0;
        detectionStateRef.current.depthVariationFrames = 0;
        detectionStateRef.current.previousDepthValues = [];
        detectionStateRef.current.liveness3DScore = 0;
        detectionStateRef.current.liveness3DDetected = false;
        // Reset enhanced detection state
        detectionStateRef.current.depthVariationHistory = [];
        detectionStateRef.current.zeroVariationFrames = 0;
        detectionStateRef.current.flatDepthFrames = 0;
        detectionStateRef.current.videoDetected = false;
        detectionStateRef.current.image2DDetected = false;

      // Start with blink detection during video recording
      setStep("BLINK");
      setStatus("Recording video... Please blink your eyes 👁️");

      // Video will continue recording until audio recording stops
      // No timeout - video records until the end
    } catch (err) {
      console.error("Error starting video recording:", err);
      setError("Failed to start video recording");
    }
  }, []);

  // Store ref for startVideoRecording
  useEffect(() => {
    startVideoRecordingRef.current = startVideoRecording;
  }, [startVideoRecording]);

  // Stop video recording
  const stopVideoRecording = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }

    // Filter out undefined frames
    const frames = detectionStateRef.current.videoFrames.filter(
      (f) => f !== undefined
    );
    detectionStateRef.current.videoFrames = frames;

    console.log(`📸 Total frames captured: ${frames.length}/4`);
    console.log("📸 Frame breakdown:", {
      blink: frames[0] ? "✅" : "❌",
      smile: frames[1] ? "✅" : "❌",
      turnLeft: frames[2] ? "✅" : "❌",
      turnRight: frames[3] ? "✅" : "❌",
    });
    console.log("✅ Video recording stopped (recorded until audio end)");
  }, []);

  // Store ref for stopVideoRecording
  useEffect(() => {
    stopVideoRecordingRef.current = stopVideoRecording;
  }, [stopVideoRecording]);

  // Start audio recording
  const startAudioRecording = useCallback(() => {
    try {
      if (!audioStreamRef.current) {
        setError("Audio stream not available");
        return;
      }

      // Get available audio MIME types
      const audioMimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];

      let selectedMimeType = "";
      for (const mimeType of audioMimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (!selectedMimeType) {
        console.warn("No supported audio MIME type found, using default");
      }

      const audioRecorder = new MediaRecorder(audioStreamRef.current, {
        mimeType: selectedMimeType || undefined,
        audioBitsPerSecond: 128000, // 128 kbps for good quality
      });

      audioChunksRef.current = [];

      audioRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log(`🎤 Audio chunk received: ${event.data.size} bytes`);
        }
      };

      audioRecorder.onstop = () => {
        console.log("✅ Audio recording stopped");
        console.log(`🎤 Total audio chunks: ${audioChunksRef.current.length}`);
        console.log(
          `🎤 Total audio size: ${audioChunksRef.current.reduce(
            (sum, chunk) => sum + chunk.size,
            0
          )} bytes`
        );

        // Stop video recording when audio stops (video recorded until the end)
        if (stopVideoRecordingRef.current) {
          stopVideoRecordingRef.current();
        }

        // Then complete verification
        setTimeout(() => {
          if (completeVerificationRef.current) {
            completeVerificationRef.current();
          }
        }, 500);
      };

      audioRecorder.onerror = (event) => {
        console.error("❌ Audio recorder error:", event);
        setError("Audio recording error occurred");
      };

      audioRecorderRef.current = audioRecorder;
      audioRecorder.start(100); // Collect data every 100ms for better quality

      // Mark audio recording as started to prevent showing number again
      detectionStateRef.current.audioRecordingStarted = true;

      setStep("RECORDING_AUDIO");
      setStatus(`Recording audio... Please read or spell: ${randomNumber}`);

      // Initialize Web Speech API for number validation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognitionWindow = window as any;
      if (
        SpeechRecognitionWindow.webkitSpeechRecognition ||
        SpeechRecognitionWindow.SpeechRecognition
      ) {
        const SpeechRecognition =
          SpeechRecognitionWindow.webkitSpeechRecognition ||
          SpeechRecognitionWindow.SpeechRecognition;
        if (SpeechRecognition) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recognition = new SpeechRecognition() as any;
          recognition.continuous = true;
          recognition.interimResults = false;
          recognition.lang = "en-US";

          recognition.onresult = (event: {
            resultIndex: number;
            results: Array<Array<{ transcript: string }>>;
          }) => {
            let transcript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
              transcript += event.results[i][0].transcript;
            }
            // Extract numbers from transcript
            const numbers = transcript.replace(/\D/g, "");
            if (numbers) {
              setSpokenNumber(numbers);
              // Validate if spoken number matches random number
              if (numbers === randomNumber) {
                setNumberValidated(true);
                setStatus(`✅ Number validated! You said: ${numbers}`);
              } else {
                setStatus(
                  `⚠️ Number mismatch. Expected: ${randomNumber}, Heard: ${numbers}`
                );
              }
            }
          };

          recognition.onerror = (event: { error: string }) => {
            console.error("Speech recognition error:", event.error);
            // Don't show error to user if it's just a no-speech or aborted error
            if (event.error !== "no-speech" && event.error !== "aborted") {
              // Only show critical errors
              if (event.error === "network" || event.error === "not-allowed") {
                setError(`Speech recognition error: ${event.error}`);
              }
            }
            // Don't reset step or show number again on error - keep recording
          };

          recognitionRef.current = recognition;
          recognition.start();
        }
      } else {
        console.warn("Speech recognition not supported in this browser");
      }

      // Record audio for 8 seconds (longer for spelling)
      setTimeout(() => {
        if (
          audioRecorderRef.current &&
          audioRecorderRef.current.state !== "inactive"
        ) {
          audioRecorderRef.current.stop();
        }
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, 8000);
    } catch (err) {
      console.error("Error starting audio recording:", err);
      setError(
        `Failed to start audio recording: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }, [randomNumber]);

  // Store ref for startAudioRecording
  useEffect(() => {
    startAudioRecordingRef.current = startAudioRecording;
  }, [startAudioRecording]);

  // Complete verification and send to backend
  const completeVerification = useCallback(async () => {
    setIsProcessing(true);
    setStep("PROCESSING");
    setStatus(
      "Processing verification data... Extracting frames from video..."
    );

    try {
      const state = detectionStateRef.current;
      const duration = Date.now() - state.startTime;

      // Create video blob
      const videoBlob =
        videoChunksRef.current.length > 0
          ? new Blob(videoChunksRef.current, { type: "video/webm" })
          : null;

      // Create audio blob
      const audioBlob =
        audioChunksRef.current.length > 0
          ? new Blob(audioChunksRef.current, { type: "audio/webm" })
          : null;

      // Get frames captured during video recording
      const detectionState = detectionStateRef.current;
      const videoFrames = detectionState.videoFrames || [];
      console.log(
        `📸 Using ${videoFrames.length} frames captured during recording`
      );
      // Get final 3D liveness result
      const liveness3DResult = calculate3DLiveness(
        detectionState.lastLandmarks || []
      );

      const result: VerificationResult = {
        success:
          numberValidated &&
          detectionState.blinkDetected &&
          detectionState.smileDetected &&
          detectionState.headTurnLeft &&
          detectionState.headTurnRight &&
          liveness3DResult.detected, // ✅ Include 3D liveness in success check
        randomNumber,
        videoBlob,
        audioBlob,
        videoFrames,
        gestures: {
          blinkDetected: detectionState.blinkDetected,
          smileDetected: detectionState.smileDetected,
          headTurnLeft: detectionState.headTurnLeft,
          headTurnRight: detectionState.headTurnRight,
        },
        numberValidation: {
          validated: numberValidated,
          spokenNumber: spokenNumber || undefined,
        },
        liveness3D: {
          detected: liveness3DResult.detected,
          score: liveness3DResult.score,
          depthVariation: liveness3DResult.depthVariation,
          confidence: liveness3DResult.confidence,
          videoDetected: liveness3DResult.videoDetected,
          image2DDetected: liveness3DResult.image2DDetected,
        },
        timestamp: Date.now(),
        duration,
      };

      console.log("✅ Verification result created:", {
        hasVideo: !!videoBlob,
        hasAudio: !!audioBlob,
        frameCount: videoFrames.length,
        randomNumber,
      });

      setVerificationResult(result);
      setStep("COMPLETE");
      setStatus("✅ Verification complete!");

      // Create URLs for video and audio playback
      if (videoBlob) {
        const url = URL.createObjectURL(videoBlob);
        setVideoUrl(url);
      }
      if (audioBlob) {
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
      }

      // Send to backend (non-blocking)
      if (sendToBackendRef.current) {
        sendToBackendRef.current(result).catch((err) => {
          console.error("Backend submission error:", err);
        });
      }
    } catch (err) {
      console.error("Error completing verification:", err);
      setError(
        `Error processing verification: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );

      // Still show result even if there's an error
      const errorDetectionState = detectionStateRef.current;
      const errorResult: VerificationResult = {
        success: false,
        randomNumber: randomNumber || "N/A",
        videoBlob:
          videoChunksRef.current.length > 0
            ? new Blob(videoChunksRef.current, { type: "video/webm" })
            : null,
        audioBlob:
          audioChunksRef.current.length > 0
            ? new Blob(audioChunksRef.current, { type: "audio/webm" })
            : null,
        videoFrames: [],
        gestures: {
          blinkDetected: errorDetectionState.blinkDetected,
          smileDetected: errorDetectionState.smileDetected,
          headTurnLeft: errorDetectionState.headTurnLeft,
          headTurnRight: errorDetectionState.headTurnRight,
        },
        numberValidation: {
          validated: numberValidated,
          spokenNumber: spokenNumber || undefined,
        },
        liveness3D: {
          detected: false,
          score: 0,
          depthVariation: 0,
          confidence: 0,
          videoDetected: false,
          image2DDetected: false,
        },
        timestamp: Date.now(),
        duration: Date.now() - detectionStateRef.current.startTime,
      };
      setVerificationResult(errorResult);
      setStep("COMPLETE");
      setStatus("⚠️ Verification completed with errors");
    } finally {
      setIsProcessing(false);
    }
  }, [randomNumber, numberValidated, spokenNumber, calculate3DLiveness]);

  // Store ref for completeVerification
  useEffect(() => {
    completeVerificationRef.current = completeVerification;
  }, [completeVerification]);

  // Send data to backend
  const sendToBackend = useCallback(async (result: VerificationResult) => {
    try {
      const formData = new FormData();

      // Add video blob
      if (result.videoBlob) {
        formData.append("video", result.videoBlob, "video.webm");
      }

      // Add audio blob
      if (result.audioBlob) {
        formData.append("audio", result.audioBlob, "audio.webm");
      }

      // Add video frames (as JSON)
      formData.append("videoFrames", JSON.stringify(result.videoFrames));

      // Add metadata
      formData.append(
        "metadata",
        JSON.stringify({
          userId: "demo-user-123",
          sessionId: generateSessionId(),
          randomNumber: result.randomNumber,
          timestamp: result.timestamp,
          duration: result.duration,
          frameCount: result.videoFrames.length,
          gestures: result.gestures,
          numberValidation: result.numberValidation,
        })
      );

      console.log("📤 Sending to backend...");
      console.log("Video size:", result.videoBlob?.size, "bytes");
      console.log("Audio size:", result.audioBlob?.size, "bytes");
      console.log("Frames:", result.videoFrames.length);

      const response = await fetch(
        "http://localhost:3001/api/video-identification",
        {
          method: "POST",
          body: formData,
        }
      );

      if (response.ok) {
        const backendResult = await response.json();
        console.log("✅ Backend response:", backendResult);
        setStatus("✅ Verification successful! Data sent to backend.");
      } else {
        console.warn("⚠️ Backend not available");
        setStatus("✅ Verification complete! (Backend offline - demo mode)");
      }
    } catch (err) {
      console.error("Error sending to backend:", err);
      setStatus("✅ Verification complete! (Backend offline - demo mode)");
    }
  }, []);

  // Store ref for sendToBackend
  useEffect(() => {
    sendToBackendRef.current = sendToBackend;
  }, [sendToBackend]);

  // MediaPipe face detection
  const onResults = useCallback(
    (results: FaceMeshResults) => {
      const state = detectionStateRef.current;

      if (!results.multiFaceLandmarks?.length) {
        state.noFaceFrames++;
        if (state.noFaceFrames > 10) {
          setError(
            "⚠️ No face detected. Please position your face in the frame"
          );
        }
        return;
      }

      if (results.multiFaceLandmarks.length > 1) {
        state.multipleFacesFrames++;
        if (state.multipleFacesFrames > 5) {
          setError("⚠️ Multiple faces detected. Only one person allowed.");
        }
        return;
      }

      // Clear errors on valid face detection
      if (state.noFaceFrames > 0 || state.multipleFacesFrames > 0) {
        state.noFaceFrames = 0;
        state.multipleFacesFrames = 0;
        setError(null);
      }

      state.faceDetected = true;
      state.faceDetectedFrames++;

      // Update canvas
      const canvas = canvasRef.current;
      const video = videoRef.current;

      if (canvas && video && video.videoWidth > 0 && video.videoHeight > 0) {
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
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      }

      const landmarks = results.multiFaceLandmarks[0] as FaceLandmark[];

      // Handle gesture detection during video recording
      const currentStep = step;
      if (currentStep === "BLINK") {
        handleBlinkDetection(landmarks);
      } else if (currentStep === "SMILE") {
        handleSmileDetection(landmarks);
      } else if (currentStep === "TURN_LEFT") {
        handleHeadTurnDetection(landmarks, "left");
      } else if (currentStep === "TURN_RIGHT") {
        handleHeadTurnDetection(landmarks, "right");
      }

      // ✅ Efficient 3D Liveness Detection (runs continuously during recording)
      // Only check during active recording steps (not READY or COMPLETE)
      if (
        currentStep !== "READY" &&
        currentStep !== "COMPLETE" &&
        currentStep !== "PROCESSING"
      ) {
        // Calculate 3D liveness every 2 frames for efficiency
        if (state.frameCount % 2 === 0) {
          calculate3DLiveness(landmarks);
        }
      }

      // Store landmarks for next frame comparison
      if (state.frameCount % 5 === 0) {
        state.lastLandmarks = landmarks.map((l: FaceLandmark) => ({ ...l }));
      }
      state.frameCount++;
    },
    [
      step,
      handleBlinkDetection,
      handleSmileDetection,
      handleHeadTurnDetection,
      calculate3DLiveness,
    ]
  );

  // Initialize MediaPipe
  useEffect(() => {
    if (step === "READY") return;

    let faceMesh: FaceMeshInstance | null = null;
    let camera: CameraInstance | null = null;

    const loadMediaPipe = async () => {
      try {
        if (!videoRef.current) return;

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
      } catch (err: unknown) {
        console.error("Error initializing face detection:", err);
        const error = err as { message?: string };
        setError(`Face detection error: ${error.message || "Unknown error"}`);
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
    };
  }, [step, onResults]);

  // Cleanup on unmount
  useEffect(() => {
    const frameInterval = frameIntervalRef.current;
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (frameInterval) {
        clearInterval(frameInterval);
      }
    };
  }, []);

  // Cleanup video and audio URLs on unmount
  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [videoUrl, audioUrl]);

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

        {/* Frame Badge */}
        {(step === "BLINK" ||
          step === "SMILE" ||
          step === "TURN_LEFT" ||
          step === "TURN_RIGHT" ||
          step === "SHOW_NUMBER") && (
          <div className={styles.frameBadge}>
            📸 Frames: {previewFrames.filter((f) => f).length}/4
          </div>
        )}

        {/* Random Number Display */}
        {step === "SHOW_NUMBER" && randomNumber && (
          <div className={styles.randomNumberDisplay}>
            <div className={styles.randomNumberLabel}>Read this number:</div>
            <div className={styles.randomNumber}>{randomNumber}</div>
          </div>
        )}

        {/* Recording Indicator */}
        {(step === "RECORDING_AUDIO" ||
          step === "BLINK" ||
          step === "SMILE" ||
          step === "TURN_LEFT" ||
          step === "TURN_RIGHT" ||
          step === "SHOW_NUMBER") && (
          <div className={styles.recordingIndicator}>
            <span className={styles.recordingDot}></span>
            {step === "BLINK" && "Recording Video - Blink"}
            {step === "SMILE" && "Recording Video - Smile"}
            {step === "TURN_LEFT" && "Recording Video - Turn Left"}
            {step === "TURN_RIGHT" && "Recording Video - Turn Right"}
            {step === "SHOW_NUMBER" && "Recording Video - Read Number"}
            {step === "RECORDING_AUDIO" && "Recording Audio"}
          </div>
        )}
      </div>

      <div className={styles.content}>
        <h1 className={styles.title}>Video Identification</h1>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.statusContainer}>
          <p className={styles.status}>{status}</p>
        </div>

        {step === "READY" && (
          <div className={styles.readySection}>
            <p className={styles.instruction}>
              This process will:
              <br />• Record a 30-second video with gestures (blink, smile, turn
              left, turn right)
              <br />• Show you a random 5-digit number after gestures
              <br />• Record your voice spelling the number
              <br />• Validate the number on frontend
              <br />• Send 4 pictures, full video, audio, and verification
              status to backend
            </p>
            <button
              onClick={startIdentification}
              className={styles.startButton}
            >
              🚀 Start Video Identification
            </button>
          </div>
        )}

        {step === "COMPLETE" && (
          <div className={styles.success}>
            {verificationResult ? (
              <>
                <h2>✅ Verification Complete!</h2>

                {/* Verification Summary */}
                <div className={styles.verificationSummary}>
                  <h3>📊 Verification Summary</h3>
                  <div className={styles.summaryGrid}>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>
                        Random Number:
                      </span>
                      <span
                        className={styles.summaryValue}
                        style={{
                          fontSize: "24px",
                          fontWeight: "700",
                          color: "#667eea",
                          letterSpacing: "4px",
                        }}
                      >
                        {verificationResult.randomNumber}
                      </span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Video Frames:</span>
                      <span className={styles.summaryValue}>
                        {verificationResult.videoFrames.length}
                      </span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Video Size:</span>
                      <span className={styles.summaryValue}>
                        {verificationResult.videoBlob
                          ? `${(
                              verificationResult.videoBlob.size /
                              1024 /
                              1024
                            ).toFixed(2)} MB`
                          : "N/A"}
                      </span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Audio Size:</span>
                      <span className={styles.summaryValue}>
                        {verificationResult.audioBlob
                          ? `${(
                              verificationResult.audioBlob.size / 1024
                            ).toFixed(2)} KB`
                          : "N/A"}
                      </span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>Duration:</span>
                      <span className={styles.summaryValue}>
                        {(verificationResult.duration / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div className={styles.summaryItem}>
                      <span className={styles.summaryLabel}>
                        Overall Result:
                      </span>
                      <span
                        className={
                          verificationResult.success
                            ? styles.statusPass
                            : styles.statusFail
                        }
                      >
                        {verificationResult.success
                          ? "✅ VERIFIED"
                          : "❌ NOT VERIFIED"}
                      </span>
                    </div>
                  </div>

                  {/* Gesture Status */}
                  <div className={styles.gestureStatus}>
                    <h4>Gesture Status:</h4>
                    <div className={styles.gestureList}>
                      <div className={styles.gestureItem}>
                        <span
                          className={
                            verificationResult.gestures.blinkDetected
                              ? styles.gesturePass
                              : styles.gestureFail
                          }
                        >
                          {verificationResult.gestures.blinkDetected
                            ? "✅"
                            : "❌"}
                        </span>
                        <span>Blink Detected</span>
                      </div>
                      <div className={styles.gestureItem}>
                        <span
                          className={
                            verificationResult.gestures.smileDetected
                              ? styles.gesturePass
                              : styles.gestureFail
                          }
                        >
                          {verificationResult.gestures.smileDetected
                            ? "✅"
                            : "❌"}
                        </span>
                        <span>Smile Detected</span>
                      </div>
                      <div className={styles.gestureItem}>
                        <span
                          className={
                            verificationResult.gestures.headTurnLeft
                              ? styles.gesturePass
                              : styles.gestureFail
                          }
                        >
                          {verificationResult.gestures.headTurnLeft
                            ? "✅"
                            : "❌"}
                        </span>
                        <span>Head Turn Left</span>
                      </div>
                      <div className={styles.gestureItem}>
                        <span
                          className={
                            verificationResult.gestures.headTurnRight
                              ? styles.gesturePass
                              : styles.gestureFail
                          }
                        >
                          {verificationResult.gestures.headTurnRight
                            ? "✅"
                            : "❌"}
                        </span>
                        <span>Head Turn Right</span>
                      </div>
                    </div>
                  </div>

                  {/* Number Validation Status */}
                  <div className={styles.numberValidation}>
                    <h4>Number Validation:</h4>
                    <div className={styles.validationDetails}>
                      <div className={styles.validationItem}>
                        <span className={styles.validationLabel}>
                          Expected:
                        </span>
                        <span className={styles.validationValue}>
                          {verificationResult.randomNumber}
                        </span>
                      </div>
                      <div className={styles.validationItem}>
                        <span className={styles.validationLabel}>Spoken:</span>
                        <span className={styles.validationValue}>
                          {verificationResult.numberValidation.spokenNumber ||
                            "Not detected"}
                        </span>
                      </div>
                      <div className={styles.validationItem}>
                        <span className={styles.validationLabel}>Status:</span>
                        <span
                          className={
                            verificationResult.numberValidation.validated
                              ? styles.statusPass
                              : styles.statusFail
                          }
                        >
                          {verificationResult.numberValidation.validated
                            ? "✅ Validated"
                            : "❌ Not Validated"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 3D Liveness Status */}
                  <div className={styles.liveness3D}>
                    <h4>🔒 3D Liveness Detection:</h4>
                    <div className={styles.liveness3DDetails}>
                      <div className={styles.liveness3DItem}>
                        <span className={styles.liveness3DLabel}>Status:</span>
                        <span
                          className={
                            verificationResult.liveness3D.detected
                              ? styles.statusPass
                              : styles.statusFail
                          }
                        >
                          {verificationResult.liveness3D.detected
                            ? "✅ Real Face Detected"
                            : "❌ Fake/Photo Detected"}
                        </span>
                      </div>
                      <div className={styles.liveness3DItem}>
                        <span className={styles.liveness3DLabel}>Score:</span>
                        <span className={styles.liveness3DValue}>
                          {verificationResult.liveness3D.score}/100
                        </span>
                      </div>
                      <div className={styles.liveness3DItem}>
                        <span className={styles.liveness3DLabel}>
                          Depth Variation:
                        </span>
                        <span className={styles.liveness3DValue}>
                          {verificationResult.liveness3D.depthVariation.toFixed(
                            3
                          )}
                        </span>
                      </div>
                      <div className={styles.liveness3DItem}>
                        <span className={styles.liveness3DLabel}>
                          Confidence:
                        </span>
                        <span className={styles.liveness3DValue}>
                          {verificationResult.liveness3D.confidence}%
                        </span>
                      </div>
                    </div>
                    <p className={styles.liveness3DNote}>
                      {verificationResult.liveness3D.image2DDetected
                        ? "❌ 2D image detected! Please use a real face, not a photo."
                        : verificationResult.liveness3D.videoDetected
                        ? "❌ Video playback detected! This appears to be a video on a screen, not a real face."
                        : verificationResult.liveness3D.detected
                        ? "✅ 3D depth analysis confirms this is a real face, not a photo, mask, or video."
                        : "⚠️ 3D depth analysis could not confirm a real face. This may be a photo, mask, video, or insufficient movement."}
                    </p>
                  </div>

                  {/* Video Player (Separate - No Audio) */}
                  {videoUrl && (
                    <div className={styles.videoPlayerSection}>
                      <h3>📹 Recorded Video (Video Only)</h3>
                      <div className={styles.videoPlayerContainer}>
                        <video
                          ref={videoPlayerRef}
                          src={videoUrl}
                          controls
                          muted
                          className={styles.playbackVideo}
                        />
                      </div>
                      <p className={styles.videoPlayerNote}>
                        Video playback without audio. Use controls to
                        play/pause.
                      </p>
                    </div>
                  )}

                  {/* Audio Player (Separate) */}
                  {audioUrl && (
                    <div className={styles.audioPlayerSection}>
                      <h3>🎤 Recorded Audio</h3>
                      <div className={styles.audioPlayerContainer}>
                        <audio
                          ref={audioPlayerRef}
                          src={audioUrl}
                          controls
                          className={styles.playbackAudio}
                        />
                      </div>
                      <p className={styles.audioPlayerNote}>
                        Audio playback. Use controls to play/pause.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2>⏳ Processing...</h2>
                <p>Please wait while we process your verification data.</p>
              </>
            )}
          </div>
        )}

        {isProcessing && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>Processing verification...</p>
          </div>
        )}

        {/* Frame Preview Section */}
        {previewFrames.filter((f) => f).length > 0 && (
          <div className={styles.photoPreview}>
            <h3>Captured Frames:</h3>
            <div className={styles.photoGrid}>
              {previewFrames.map((frame, index) => {
                if (!frame) return null;
                const labels = ["Blink", "Smile", "Head Left", "Head Right"];
                return (
                  <div key={index} className={styles.photoItem}>
                    <img src={frame} alt={`Frame ${index + 1}`} />
                    <span className={styles.photoLabel}>
                      {labels[index] || `Frame ${index + 1}`}
                    </span>
                  </div>
                );
              })}
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
