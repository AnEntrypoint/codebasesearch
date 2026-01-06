import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const onnxPath = path.join(__dirname, '..', 'node_modules', '@xenova', 'transformers', 'src', 'backends', 'onnx.js');

// Only patch if file exists
if (!fs.existsSync(onnxPath)) {
  console.log('onnx.js not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(onnxPath, 'utf-8');

// Check if already patched
if (content.includes('Windows compatibility')) {
  console.log('onnx.js already patched, skipping');
  process.exit(0);
}

// Replace the hard import with a try-catch wrapper
content = content.replace(
  `import * as ONNX_NODE from 'onnxruntime-node';`,
  `// Windows compatibility: onnxruntime-node may not be available
let ONNX_NODE;
try {
  ONNX_NODE = await (async () => {
    try {
      const mod = await import('onnxruntime-node');
      return mod;
    } catch (e) {
      return null;
    }
  })();
} catch (e) {
  ONNX_NODE = null;
}`
);

// Update the logic to handle null ONNX_NODE
content = content.replace(
  `if (typeof process !== 'undefined' && process?.release?.name === 'node') {
    // Running in a node-like environment.
    ONNX = ONNX_NODE.default ?? ONNX_NODE;

    // Add \`cpu\` execution provider, with higher precedence that \`wasm\`.
    executionProviders.unshift('cpu');

} else {`,
  `if (typeof process !== 'undefined' && process?.release?.name === 'node' && ONNX_NODE) {
    // Running in a node-like environment with onnxruntime-node available.
    ONNX = ONNX_NODE.default ?? ONNX_NODE;

    // Add \`cpu\` execution provider, with higher precedence that \`wasm\`.
    executionProviders.unshift('cpu');

} else {`
);

fs.writeFileSync(onnxPath, content);
console.log('Successfully patched onnx.js for Windows compatibility');

// Also patch image.js to handle missing sharp on Windows
const imagePath = path.join(__dirname, '..', 'node_modules', '@xenova', 'transformers', 'src', 'utils', 'image.js');

if (fs.existsSync(imagePath)) {
  let imageContent = fs.readFileSync(imagePath, 'utf-8');

  // Check if already patched
  if (!imageContent.includes('Optional import of sharp')) {
    // Replace the hard import with optional loading
    imageContent = imageContent.replace(
      `// Will be empty (or not used) if running in browser or web-worker
import sharp from 'sharp';`,
      `// Will be empty (or not used) if running in browser or web-worker
// Optional import of sharp - disabled for Windows compatibility
let sharp = null;
// Try to load sharp asynchronously
if (typeof process !== 'undefined' && process?.release?.name === 'node') {
  (async () => {
    try {
      const mod = await import('sharp');
      sharp = mod.default || mod;
    } catch (e) {
      // Sharp not available, will fall back to other methods
    }
  })();
}`
    );

    // Also add a fallback for when sharp is not available
    imageContent = imageContent.replace(
      `} else {
    throw new Error('Unable to load image processing library.');
}`,
      `} else {
    // Fallback: provide a stub that works for text-only use cases
    if (typeof self !== 'undefined' && self.OffscreenCanvas) {
        // Browser canvas available
        createCanvasFunction = (width, height) => new self.OffscreenCanvas(width, height);
        loadImageFunction = self.createImageBitmap;
        ImageDataClass = self.ImageData;
    } else {
        // No image support available, but this is OK for text embeddings
        loadImageFunction = () => {
            throw new Error('Image processing not available. Please use text input.');
        };
    }
}`
    );

    fs.writeFileSync(imagePath, imageContent);
    console.log('Successfully patched image.js for Windows compatibility');
  } else {
    console.log('image.js already patched, skipping');
  }
}
