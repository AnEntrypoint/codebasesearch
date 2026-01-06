// Windows compatibility initialization
// Patch transformers image.js to make sharp optional

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Patch the image.js file to handle missing sharp
const imagePath = path.join(__dirname, '..', 'node_modules', '@xenova', 'transformers', 'src', 'utils', 'image.js');

if (fs.existsSync(imagePath)) {
  let content = fs.readFileSync(imagePath, 'utf-8');

  // Only patch if not already patched
  if (!content.includes('WINDOWS_COMPATIBILITY_PATCHED')) {
    // Replace the sharp import with optional loading
    content = content.replace(
      `import sharp from 'sharp';`,
      `// WINDOWS_COMPATIBILITY_PATCHED
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  // sharp not available on Windows or not installed
}`
    );

    // Make the fallback handling more robust
    content = content.replace(
      `} else {
    throw new Error('Unable to load image processing library.');
}`,
      `} else {
    // Fallback for systems without image support (OK for text-only)
    loadImageFunction = async () => { throw new Error('Image processing unavailable'); };
}`
    );

    try {
      fs.writeFileSync(imagePath, content);
    } catch (e) {
      // Silently fail if read-only
    }
  }
}
