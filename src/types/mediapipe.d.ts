// Type definitions for MediaPipe Face Mesh
declare global {
  interface Window {
    FaceMesh: new (config: {
      locateFile: (file: string) => string;
    }) => FaceMeshInstance;
  }
}

export interface FaceMeshInstance {
  setOptions(options: {
    maxNumFaces?: number;
    refineLandmarks?: boolean;
    minDetectionConfidence?: number;
    minTrackingConfidence?: number;
  }): void;
  onResults(callback: (results: FaceMeshResults) => void): void;
  send(data: { image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement }): Promise<void>;
  close(): void;
}

export interface FaceMeshResults {
  image: HTMLCanvasElement;
  multiFaceLandmarks?: FaceLandmark[][];
}

export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export interface CameraConfig {
  onFrame: () => Promise<void>;
  width?: number;
  height?: number;
}

export interface CameraInstance {
  start(): Promise<void>;
  stop(): void;
}

// Type for camera_utils module
declare module "@mediapipe/camera_utils" {
  export class Camera {
    constructor(
      videoElement: HTMLVideoElement,
      config: CameraConfig
    );
    start(): Promise<void>;
    stop(): void;
  }
}

export {};

