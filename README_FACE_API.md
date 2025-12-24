# Face-api.js Models Setup Guide

## Step 1: Install face-api.js

```bash
npm install face-api.js
```

## Step 2: Download Models

Face-api.js ko models chahiye. Models ko `public/models` folder mein rakhein.

### Option 1: Manual Download (Recommended)

1. Models download karein: https://github.com/justadudewhohacks/face-api.js-models
2. Ya direct download karein:
   - https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/tiny_face_detector_model-weights_manifest.json
   - https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/tiny_face_detector_model-shard1
   - https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_landmark_68_model-weights_manifest.json
   - https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_landmark_68_model-shard1
   - https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_recognition_model-weights_manifest.json
   - https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_recognition_model-shard1

3. Files ko `public/models/` folder mein save karein:

```
public/
  models/
    tiny_face_detector_model-weights_manifest.json
    tiny_face_detector_model-shard1
    face_landmark_68_model-weights_manifest.json
    face_landmark_68_model-shard1
    face_recognition_model-weights_manifest.json
    face_recognition_model-shard1
```

### Option 2: Using Script

```bash
# Create models directory
mkdir -p public/models

# Download models (using curl or wget)
cd public/models

# Download tiny_face_detector
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/tiny_face_detector_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/tiny_face_detector_model-shard1

# Download face_landmark_68
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_landmark_68_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_landmark_68_model-shard1

# Download face_recognition
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_recognition_model-weights_manifest.json
curl -O https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/weights/face_recognition_model-shard1
```

## Step 3: Verify Setup

Models download ke baad, `public/models` folder mein yeh files honi chahiye:

- ✅ tiny_face_detector_model-weights_manifest.json
- ✅ tiny_face_detector_model-shard1
- ✅ face_landmark_68_model-weights_manifest.json
- ✅ face_landmark_68_model-shard1
- ✅ face_recognition_model-weights_manifest.json
- ✅ face_recognition_model-shard1

## Step 4: Run Application

```bash
npm run dev
```

Phir browser mein `/nine` route pe jao aur test karein!

## Troubleshooting

### Error: "Models load nahi ho rahe"

1. Check karein ke `public/models` folder exist karta hai
2. Check karein ke sab files properly download hui hain
3. Browser console mein errors check karein
4. Network tab mein check karein ke models load ho rahe hain

### Error: "CORS error"

Next.js automatically serve karta hai `public` folder ko. Agar CORS error aaye, to check karein ke:
- Models `public/models` mein hain (not `src/models`)
- Next.js dev server properly run ho raha hai

### Models slow load ho rahe hain

Pehli baar models load hote waqt thoda time lag sakta hai (~5-10 seconds). Baad mein cached ho jayenge.

## Model Sizes

- tiny_face_detector: ~190 KB
- face_landmark_68: ~1.2 MB
- face_recognition: ~5.4 MB

Total: ~7 MB (first load only, then cached)

