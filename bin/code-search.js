#!/usr/bin/env node

// MUST patch sharp before any other imports
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');

if (fs.existsSync(distPath)) {
  let content = fs.readFileSync(distPath, 'utf-8');
  if (!content.includes('SHARP_REMOVED_FOR_WINDOWS_COMPATIBILITY')) {
    content = content.replace(/import \* as __WEBPACK_EXTERNAL_MODULE_sharp__ from "sharp";\n/, '// SHARP_REMOVED_FOR_WINDOWS_COMPATIBILITY\n');
    content = content.replace(/module\.exports = __WEBPACK_EXTERNAL_MODULE_sharp__;/g, 'module.exports = {};');
    content = content.replace(/} else \{\s*throw new Error\('Unable to load image processing library\.'\);\s*\}/, '} else {\n    loadImageFunction = async () => { throw new Error(\'Image processing unavailable\'); };\n}');
    try { fs.writeFileSync(distPath, content); } catch (e) {}
  }
}

import('../src/cli.js').then(m => m.run(process.argv.slice(2)))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
