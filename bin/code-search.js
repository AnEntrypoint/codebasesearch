#!/usr/bin/env node

import('../src/cli.js').then(m => m.run(process.argv.slice(2)))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
