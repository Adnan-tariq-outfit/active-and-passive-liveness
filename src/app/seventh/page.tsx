'use client'
import React, { useRef, useState, useEffect } from 'react';

function FaceLivenessVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480 } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStreaming(true);
        console.log('📹 Camera start ho gaya!');
      }
    } catch (error) {
      console.error('❌ Camera access error:', error);
      alert('Camera access denied!');
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      setStreaming(false);
    }
  };

  const captureAndCheck = async () => {
    if (!streaming) return;

    console.log('📸 Frame capture kar rahe hain...');

    // Canvas mein video frame capture karein
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0);

    // Canvas ko blob mein convert karein
    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('image', blob, 'frame.jpg');

      try {
        const response = await fetch('http://localhost:3001/api/check-face-liveness', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        
        console.log('=== LIVE CHECK RESULT ===');
        console.log('Is Live:', data.isLive);
        console.log('Confidence:', data.confidence);
        
        setResult(data);

      } catch (error) {
        console.error('❌ Error:', error);
      }
    }, 'image/jpeg');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🎥 Face Liveness - Video Stream</h1>

      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{
            width: '100%',
            maxWidth: '640px',
            border: '3px solid #ddd',
            borderRadius: '10px',
            backgroundColor: '#000'
          }}
        />
        
        {result && (
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            padding: '10px',
            backgroundColor: result.isLive ? 'rgba(40, 167, 69, 0.9)' : 'rgba(220, 53, 69, 0.9)',
            color: 'white',
            borderRadius: '5px',
            fontWeight: 'bold'
          }}>
            {result.isLive ? '✅ LIVE' : '❌ SPOOF'}
            <br />
            {result.confidence}%
          </div>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <button
        onClick={captureAndCheck}
        disabled={!streaming}
        style={{
          padding: '15px 30px',
          fontSize: '16px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: streaming ? 'pointer' : 'not-allowed',
          width: '100%'
        }}
      >
        📸 Capture & Check Liveness
      </button>

      {result && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          backgroundColor: '#f8f9fa',
          borderRadius: '5px',
          border: '2px solid #ddd'
        }}>
          <h3>Latest Result:</h3>
          <p><strong>Status:</strong> {result.isLive ? '✅ Real' : '❌ Spoof'}</p>
          <p><strong>Confidence:</strong> {result.confidence}%</p>
          <p><strong>Brightness:</strong> {result.quality?.brightness}</p>
          <p><strong>Sharpness:</strong> {result.quality?.sharpness}</p>
        </div>
      )}
    </div>
  );
}

export default FaceLivenessVideo;