"use client";
import React, { useState, useRef, useEffect } from "react";
import * as faceapi from "face-api.js";
import styles from "./page.module.css";

interface ComparisonResult {
  match: boolean;
  similarity: number;
  distance: number;
  face1Detected: boolean;
  face2Detected: boolean;
  message: string;
}

export default function FaceComparisonPage() {
  const [image1, setImage1] = useState<string | null>(null);
  const [image2, setImage2] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const img1Ref = useRef<HTMLImageElement>(null);
  const img2Ref = useRef<HTMLImageElement>(null);

  // Load face-api.js models
  useEffect(() => {
    const loadModels = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try local models first, fallback to CDN if not available
        const LOCAL_MODEL_URL = "/models";
        const CDN_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

        console.log("🔄 Loading face models...");
        
        try {
          // Try loading from local models first
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL_MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(LOCAL_MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(LOCAL_MODEL_URL),
          ]);
          console.log("✅ Models loaded from local folder");
        } catch (localError) {
          console.warn("⚠️ Local models not found, trying CDN...", localError);
          // Fallback to CDN
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(CDN_MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(CDN_MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(CDN_MODEL_URL),
          ]);
          console.log("✅ Models loaded from CDN");
        }

        setModelsLoaded(true);
        console.log("✅ Face models loaded successfully");
      } catch (err) {
        console.error("❌ Error loading models:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(
          `Models load nahi ho rahe. Error: ${errorMessage}. Please check ke models /public/models folder mein hain aur Next.js dev server restart karein.`
        );
      } finally {
        setLoading(false);
      }
    };

    loadModels();
  }, []);

  // Handle image 1 upload
  const handleImage1Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageUrl = event.target?.result as string;
        setImage1(imageUrl);
        setResult(null); // Reset result when new image uploaded
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle image 2 upload
  const handleImage2Change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageUrl = event.target?.result as string;
        setImage2(imageUrl);
        setResult(null); // Reset result when new image uploaded
      };
      reader.readAsDataURL(file);
    }
  };

  // Extract face descriptor from image
  const getFaceDescriptor = async (
    imageUrl: string
  ): Promise<Float32Array | null> => {
    try {
      const img = await faceapi.fetchImage(imageUrl);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection) {
        return detection.descriptor; // 128-dimensional vector
      }
      return null;
    } catch (err) {
      console.error("Error extracting face descriptor:", err);
      return null;
    }
  };

  // Compare two images
  const compareImages = async () => {
    if (!image1 || !image2) {
      setError("Please upload both images");
      return;
    }

    if (!modelsLoaded) {
      setError("Models abhi load nahi hue. Please wait...");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setResult(null);

      console.log("🔍 Comparing images...");

      // Extract face descriptors from both images
      const descriptor1 = await getFaceDescriptor(image1);
      const descriptor2 = await getFaceDescriptor(image2);

      // Check if faces detected
      if (!descriptor1 || !descriptor2) {
        setResult({
          match: false,
          similarity: 0,
          distance: Infinity,
          face1Detected: !!descriptor1,
          face2Detected: !!descriptor2,
          message: !descriptor1 && !descriptor2
            ? "❌ Dono images mein face detect nahi hua"
            : !descriptor1
            ? "❌ Pehli image mein face detect nahi hua"
            : "❌ Doosri image mein face detect nahi hua",
        });
        setLoading(false);
        return;
      }

      // Calculate Euclidean distance between descriptors
      let distance = 0;
      for (let i = 0; i < descriptor1.length; i++) {
        distance += Math.pow(descriptor1[i] - descriptor2[i], 2);
      }
      distance = Math.sqrt(distance);

      // Convert distance to similarity percentage (0-100%)
      // Lower distance = Higher similarity
      const similarity = Math.max(0, (1 - distance) * 100);

      // Threshold for matching (0.6 is standard, lower = stricter)
      const THRESHOLD = 0.6;
      const match = distance < THRESHOLD;

      // Generate message
      let message = "";
      if (match) {
        if (similarity >= 85) {
          message = `✅ Same person hai! (${similarity.toFixed(2)}% similar)`;
        } else if (similarity >= 70) {
          message = `✅ Likely same person (${similarity.toFixed(2)}% similar)`;
        } else {
          message = `⚠️ Possibly same person (${similarity.toFixed(2)}% similar)`;
        }
      } else {
        message = `❌ Different person hai (${similarity.toFixed(2)}% similar)`;
      }

      setResult({
        match,
        similarity: Math.round(similarity * 100) / 100,
        distance: Math.round(distance * 10000) / 10000,
        face1Detected: true,
        face2Detected: true,
        message,
      });

      console.log("✅ Comparison complete:", {
        match,
        similarity: `${similarity.toFixed(2)}%`,
        distance: distance.toFixed(4),
      });
    } catch (err) {
      console.error("Error comparing images:", err);
      setError("Images compare karte waqt error aaya. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Face Comparison</h1>
        <p className={styles.subtitle}>
          Do images upload karein aur check karein ke same person ki hain ya nahi
        </p>

        {/* Models Loading Status */}
        {loading && !modelsLoaded && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>Models load ho rahe hain... Please wait</p>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {modelsLoaded && (
          <div className={styles.status}>
            ✅ Models loaded successfully
          </div>
        )}

        {/* Image Upload Section */}
        <div className={styles.uploadSection}>
          <div className={styles.imageContainer}>
            <h3>Image 1</h3>
            <input
              type="file"
              accept="image/*"
              onChange={handleImage1Change}
              className={styles.fileInput}
              id="image1"
            />
            <label htmlFor="image1" className={styles.uploadButton}>
              📷 Upload Image 1
            </label>
            {image1 && (
              <div className={styles.imagePreview}>
                <img
                  ref={img1Ref}
                  src={image1}
                  alt="Image 1"
                  className={styles.previewImage}
                />
              </div>
            )}
          </div>

          <div className={styles.imageContainer}>
            <h3>Image 2</h3>
            <input
              type="file"
              accept="image/*"
              onChange={handleImage2Change}
              className={styles.fileInput}
              id="image2"
            />
            <label htmlFor="image2" className={styles.uploadButton}>
              📷 Upload Image 2
            </label>
            {image2 && (
              <div className={styles.imagePreview}>
                <img
                  ref={img2Ref}
                  src={image2}
                  alt="Image 2"
                  className={styles.previewImage}
                />
              </div>
            )}
          </div>
        </div>

        {/* Compare Button */}
        {image1 && image2 && modelsLoaded && (
          <button
            onClick={compareImages}
            disabled={loading}
            className={styles.compareButton}
          >
            {loading ? "⏳ Comparing..." : "🔍 Compare Images"}
          </button>
        )}

        {/* Results Section */}
        {result && (
          <div className={styles.resultSection}>
            <h2>Comparison Result</h2>
            <div
              className={`${styles.resultCard} ${
                result.match ? styles.match : styles.noMatch
              }`}
            >
              <div className={styles.resultMessage}>{result.message}</div>
              <div className={styles.resultDetails}>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Similarity:</span>
                  <span className={styles.value}>
                    {result.similarity}%
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Distance:</span>
                  <span className={styles.value}>{result.distance}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Face 1 Detected:</span>
                  <span className={styles.value}>
                    {result.face1Detected ? "✅ Yes" : "❌ No"}
                  </span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.label}>Face 2 Detected:</span>
                  <span className={styles.value}>
                    {result.face2Detected ? "✅ Yes" : "❌ No"}
                  </span>
                </div>
              </div>

              {/* Similarity Bar */}
              <div className={styles.similarityBar}>
                <div
                  className={styles.similarityFill}
                  style={{ width: `${result.similarity}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className={styles.instructions}>
          <h3>How to use:</h3>
          <ol>
            <li>Pehle models load hone ka wait karein</li>
            <li>Do images upload karein (Image 1 aur Image 2)</li>
            <li>&quot;Compare Images&quot; button click karein</li>
            <li>Result dekhein - same person hai ya nahi</li>
          </ol>
          <p className={styles.note}>
            <strong>Note:</strong> Models ko pehle download karna hoga. Check README for
            instructions.
          </p>
        </div>
      </div>
    </div>
  );
}
