import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Patch @huggingface/transformers dist file for Windows compatibility
const distPath = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');

if (!fs.existsSync(distPath)) {
  console.log('transformers.node.mjs not found, skipping patch');
  process.exit(0);
}

let distContent = fs.readFileSync(distPath, 'utf-8');

// Check if already patched
if (distContent.includes('SHARP_PATCHED_FOR_WINDOWS')) {
  console.log('transformers.node.mjs already patched');
  process.exit(0);
}

// Remove sharp import line
distContent = distContent.replace(
  /import \* as __WEBPACK_EXTERNAL_MODULE_sharp__ from "sharp";\n/,
  '// SHARP_PATCHED_FOR_WINDOWS: sharp removed\n'
);

// Replace sharp module exports with stub
distContent = distContent.replace(
  /module\.exports = __WEBPACK_EXTERNAL_MODULE_sharp__;/g,
  'module.exports = {};'
);

// Replace image processing error with fallback
distContent = distContent.replace(
  /} else \{\s*throw new Error\('Unable to load image processing library\.'\);\s*\}/,
  '} else {\n    loadImageFunction = async () => { throw new Error(\'Image processing unavailable\'); };\n}'
);

fs.writeFileSync(distPath, distContent);
console.log('Successfully patched transformers.node.mjs for Windows compatibility');
