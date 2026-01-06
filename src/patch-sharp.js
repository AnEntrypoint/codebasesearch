// Auto-patch transformers dist for sharp removal
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');

if (fs.existsSync(distPath)) {
  let content = fs.readFileSync(distPath, 'utf-8');

  // Only patch if not already patched
  if (!content.includes('SHARP_REMOVED_FOR_WINDOWS_COMPATIBILITY')) {
    // Remove sharp import
    content = content.replace(
      /import \* as __WEBPACK_EXTERNAL_MODULE_sharp__ from "sharp";\n/,
      '// SHARP_REMOVED_FOR_WINDOWS_COMPATIBILITY\n'
    );

    // Replace sharp module export with stub
    content = content.replace(
      /module\.exports = __WEBPACK_EXTERNAL_MODULE_sharp__;/g,
      'module.exports = {};'
    );

    // Replace image processing error with fallback
    content = content.replace(
      /} else \{\s*throw new Error\('Unable to load image processing library\.'\);\s*\}/,
      '} else {\n    loadImageFunction = async () => { throw new Error(\'Image processing unavailable\'); };\n}'
    );

    try {
      fs.writeFileSync(distPath, content);
    } catch (e) {
      // Silently continue if unable to patch (read-only filesystem)
    }
  }
}
