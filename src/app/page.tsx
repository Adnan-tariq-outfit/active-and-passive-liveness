"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import styles from "./page.module.css";
import type { FaceMeshInstance, FaceMeshResults, CameraInstance, FaceLandmark, CameraConfig } from "@/types/mediapipe";

type GestureStep = "BLINK" | "SMILE" | "TURN_LEFT" | "TURN_RIGHT" | "COMPLETE";

interface DetectionState {
  blinkCount: number;
  smileDetected: boolean;
  headTurnLeft: boolean;
  headTurnRight: boolean;
  lastEyeAspectRatio: number;
  consecutiveFrames: number;
}

export default function FaceLiveness() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Position your face in the frame");
  const [step, setStep] = useState<GestureStep>("BLINK");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const detectionStateRef = useRef<DetectionState>({
    blinkCount: 0,
    smileDetected: false,
    headTurnLeft: false,
    headTurnRight: false,
    lastEyeAspectRatio: 0.3,
    consecutiveFrames: 0,
  });

  const handleBlinkDetection = useCallback((landmarks: FaceLandmark[]) => {
    const eyeAspectRatio = calculateEyeAspectRatio(landmarks);
    const state = detectionStateRef.current;

    // Detect blink: eye closes (EAR decreases) then opens (EAR increases)
    if (eyeAspectRatio < 0.2 && state.lastEyeAspectRatio > 0.25) {
      // Eye closing
      state.consecutiveFrames++;
    } else if (eyeAspectRatio > 0.25 && state.lastEyeAspectRatio < 0.2) {
      // Eye opening - blink completed
      if (state.consecutiveFrames > 0) {
        state.blinkCount++;
        state.consecutiveFrames = 0;
        setProgress((state.blinkCount / 2) * 33);
        
        if (state.blinkCount >= 2) {
          setStatus("Great! Now please smile 😊");
          setStep("SMILE");
          state.blinkCount = 0;
        } else {
          setStatus(`Blink detected (${state.blinkCount}/2) 👁️`);
        }
      }
    }

    state.lastEyeAspectRatio = eyeAspectRatio;
  }, []);

  const handleSmileDetection = useCallback((landmarks: FaceLandmark[]) => {
    const mouthOpenness = calculateMouthOpenness(landmarks);
    const state = detectionStateRef.current;

    if (mouthOpenness > 0.02) {
      state.smileDetected = true;
      setProgress(66);
      setStatus("Smile detected! Now turn your head left 👈");
      setStep("TURN_LEFT");
    }
  }, []);

  const handleHeadTurnDetection = useCallback((landmarks: FaceLandmark[], direction: "left" | "right") => {
    const headPose = calculateHeadPose(landmarks);
    const state = detectionStateRef.current;

    if (direction === "left" && headPose < -0.15) {
      state.headTurnLeft = true;
      setStatus("Good! Now turn your head right 👉");
      setStep("TURN_RIGHT");
    } else if (direction === "right" && headPose > 0.15) {
      state.headTurnRight = true;
      setProgress(100);
      setStatus("Liveness verified! ✅");
      setStep("COMPLETE");
    }
  }, []);

  const onResults = useCallback((results: FaceMeshResults) => {
    if (!results.multiFaceLandmarks?.length) {
      setStatus("No face detected. Please position your face in the frame");
      return;
    }

    const landmarks = results.multiFaceLandmarks[0] as FaceLandmark[];
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (canvas && video) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }

    // Process gestures based on current step
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
  }, [step, handleBlinkDetection, handleSmileDetection, handleHeadTurnDetection]);

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

        // Check if we're on HTTPS or localhost (required for camera access)
        if (typeof window !== "undefined") {
          const isSecure = window.location.protocol === "https:" || 
                          window.location.hostname === "localhost" || 
                          window.location.hostname === "127.0.0.1";
          if (!isSecure) {
            setError("Camera access requires HTTPS or localhost. Please use https:// or run on localhost.");
            return;
          }
        }

        // Request camera access first
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              facingMode: "user",
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
            setError("Camera permission denied. Please allow camera access and refresh the page.");
          } else if (error.name === "NotFoundError") {
            setError("No camera found. Please connect a camera and refresh.");
          } else {
            setError(`Camera error: ${error.message || "Please check your camera permissions."}`);
          }
          return;
        }

        // Import MediaPipe packages
        // These packages use a special export pattern
        const faceMeshPkg = await import("@mediapipe/face_mesh");
        const cameraUtilsPkg = await import("@mediapipe/camera_utils");

        // MediaPipe packages export the classes in different ways
        // Try to get FaceMesh class
        type FaceMeshModule = {
          FaceMesh?: new (config: { locateFile: (file: string) => string }) => FaceMeshInstance;
          default?: FaceMeshModule | (new (config: { locateFile: (file: string) => string }) => FaceMeshInstance);
        };

        type CameraModule = {
          Camera?: new (video: HTMLVideoElement, config: CameraConfig) => CameraInstance;
          default?: CameraModule | (new (video: HTMLVideoElement, config: CameraConfig) => CameraInstance);
        };

        type FaceMeshConstructor = new (config: { locateFile: (file: string) => string }) => FaceMeshInstance;
        type CameraConstructor = new (video: HTMLVideoElement, config: CameraConfig) => CameraInstance;
        
        let FaceMeshClass: FaceMeshConstructor | null = null;
        
        const fmPkg = faceMeshPkg as unknown as FaceMeshModule;
        
        // Check various export patterns
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

        // If still not found, check window (some builds attach to window)
        const windowFaceMesh = (window as unknown as { FaceMesh?: FaceMeshConstructor }).FaceMesh;
        if (!FaceMeshClass && windowFaceMesh) {
          FaceMeshClass = windowFaceMesh;
        }

        if (!FaceMeshClass) {
          console.error("FaceMesh module:", faceMeshPkg);
          throw new Error(
            "Could not find FaceMesh class. The package structure may have changed. " +
            "Please check the console for the module structure."
          );
        }

        // Initialize FaceMesh
        faceMesh = new FaceMeshClass({
          locateFile: (file: string) => {
            // Use CDN for MediaPipe files
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
          },
        });

        if (faceMesh) {
          faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });

          faceMesh.onResults(onResults);
        }

        // Get Camera class
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

        const windowCamera = (window as unknown as { Camera?: CameraConstructor }).Camera;
        if (!CameraClass && windowCamera) {
          CameraClass = windowCamera;
        }

        if (!CameraClass) {
          console.error("Camera module:", cameraUtilsPkg);
          throw new Error(
            "Could not find Camera class. The package structure may have changed. " +
            "Please check the console for the module structure."
          );
        }

        camera = new CameraClass(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMesh) {
              await faceMesh.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480,
        });

        if (camera) {
          await camera.start();
        }
        setStatus("Please blink your eyes 👁️");
      } catch (err: unknown) {
        console.error("Error initializing face detection:", err);
        const error = err as { message?: string };
        setError(`Initialization error: ${error.message || "Please check the console for details."}`);
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
      // Stop video stream
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
        <canvas
          ref={canvasRef}
          className={styles.canvas}
        />
      </div>

      <div className={styles.content}>
        <h1 className={styles.title}>Face Authentication</h1>
        
        {error && (
          <div className={styles.error}>{error}</div>
        )}

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

        {step === "COMPLETE" && (
          <div className={styles.success}>
            <h2>✅ Authentication Successful!</h2>
            <p>All liveness checks passed</p>
          </div>
        )}

        <div className={styles.instructions}>
          <h3>Instructions:</h3>
          <ul>
            <li className={step === "BLINK" ? styles.active : ""}>
              Blink your eyes twice
            </li>
            <li className={step === "SMILE" ? styles.active : ""}>
              Smile naturally
            </li>
            <li className={step === "TURN_LEFT" ? styles.active : ""}>
              Turn your head left
            </li>
            <li className={step === "TURN_RIGHT" ? styles.active : ""}>
              Turn your head right
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Detection Algorithms ---------------- */

// Eye Aspect Ratio (EAR) - detects blinks
function calculateEyeAspectRatio(landmarks: FaceLandmark[]): number {
  // Left eye landmarks
  const leftEyeTop = landmarks[159];
  const leftEyeBottom = landmarks[145];
  const leftEyeLeft = landmarks[33];
  const leftEyeRight = landmarks[133];

  // Right eye landmarks
  const rightEyeTop = landmarks[386];
  const rightEyeBottom = landmarks[374];
  const rightEyeLeft = landmarks[362];
  const rightEyeRight = landmarks[263];

  // Calculate vertical and horizontal distances for left eye
  const leftVertical = Math.abs(leftEyeTop.y - leftEyeBottom.y);
  const leftHorizontal = Math.abs(leftEyeLeft.x - leftEyeRight.x);

  // Calculate vertical and horizontal distances for right eye
  const rightVertical = Math.abs(rightEyeTop.y - rightEyeBottom.y);
  const rightHorizontal = Math.abs(rightEyeLeft.x - rightEyeRight.x);

  // Calculate EAR for both eyes
  const leftEAR = leftVertical / (leftHorizontal + 0.001);
  const rightEAR = rightVertical / (rightHorizontal + 0.001);

  // Average EAR
  return (leftEAR + rightEAR) / 2;
}

// Mouth openness - detects smiles
function calculateMouthOpenness(landmarks: FaceLandmark[]): number {
  const topLip = landmarks[13];
  const bottomLip = landmarks[14];
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];

  const verticalDistance = Math.abs(topLip.y - bottomLip.y);
  const horizontalDistance = Math.abs(leftCorner.x - rightCorner.x);

  return verticalDistance / (horizontalDistance + 0.001);
}

// Head pose - detects head rotation
function calculateHeadPose(landmarks: FaceLandmark[]): number {
  // Use nose tip and face edges to determine head rotation
  const noseTip = landmarks[1];
  const leftFaceEdge = landmarks[234];
  const rightFaceEdge = landmarks[454];

  // Calculate face center
  const faceCenterX = (leftFaceEdge.x + rightFaceEdge.x) / 2;
  
  // Calculate nose offset from center (negative = left turn, positive = right turn)
  const noseOffset = noseTip.x - faceCenterX;

  // Normalize based on face width
  const faceWidth = Math.abs(leftFaceEdge.x - rightFaceEdge.x);
  const normalizedOffset = noseOffset / (faceWidth + 0.001);

  return normalizedOffset;
}

