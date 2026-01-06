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
