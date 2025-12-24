# Face-api.js Models Download Script
# Run this script to download models manually

$modelsPath = "public\models"
$baseUrl = "https://github.com/justadudewhohacks/face-api.js-models/raw/master/weights"

# Create models directory if it doesn't exist
if (-not (Test-Path $modelsPath)) {
    New-Item -ItemType Directory -Force -Path $modelsPath | Out-Null
}

Write-Host "📥 Downloading face-api.js models..." -ForegroundColor Cyan

$files = @(
    "tiny_face_detector_model-weights_manifest.json",
    "tiny_face_detector_model-shard1",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model-shard1",
    "face_recognition_model-weights_manifest.json",
    "face_recognition_model-shard1"
)

foreach ($file in $files) {
    $url = "$baseUrl/$file"
    $output = Join-Path $modelsPath $file
    
    Write-Host "Downloading: $file..." -ForegroundColor Yellow
    
    try {
        # Use BITS for better reliability on Windows
        Start-BitsTransfer -Source $url -Destination $output -ErrorAction Stop
        Write-Host "✅ $file downloaded successfully" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to download $file" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host "Trying alternative method..." -ForegroundColor Yellow
        
        try {
            Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing -TimeoutSec 60
            Write-Host "✅ $file downloaded successfully (alternative method)" -ForegroundColor Green
        } catch {
            Write-Host "❌ Failed to download $file with alternative method" -ForegroundColor Red
        }
    }
}

Write-Host "`n✅ Download complete! Check public\models folder" -ForegroundColor Green
Write-Host "`nIf download failed, you can:" -ForegroundColor Yellow
Write-Host "1. Download manually from: https://github.com/justadudewhohacks/face-api.js-models/tree/master/weights" -ForegroundColor Cyan
Write-Host "2. Or use CDN (models will load automatically from CDN if local files not found)" -ForegroundColor Cyan

