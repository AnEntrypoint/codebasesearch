// Windows compatibility initialization
// This module patches transformers.js for Windows compatibility before any imports

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function patchTransformersForWindows() {
  const imagePath = path.join(__dirname, '..', 'node_modules', '@xenova', 'transformers', 'src', 'utils', 'image.js');

  if (!fs.existsSync(imagePath)) {
    return; // Not installed yet
  }

  let content = fs.readFileSync(imagePath, 'utf-8');

  // Check if already patched
  if (content.includes('Optional import of sharp')) {
    return; // Already patched
  }

  // Replace the hard import with optional loading
  content = content.replace(
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
  content = content.replace(
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

  try {
    fs.writeFileSync(imagePath, content);
  } catch (e) {
    // Silently fail if we can't write (might be read-only)
  }
}

// Run patching
patchTransformersForWindows();
