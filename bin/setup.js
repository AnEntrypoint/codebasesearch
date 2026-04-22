#!/usr/bin/env node

import { pipeline } from '@huggingface/transformers';

const DEVICES = ['cuda', 'dml', 'webgpu', 'cpu'];
const DTYPES = ['fp32', 'q8'];

async function detectBestDevice() {
    for (const device of DEVICES) {
        for (const dtype of DTYPES) {
            try {
                const t0 = Date.now();
                const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device, dtype });
                const tLoad = Date.now() - t0;
                const probe = Array.from({ length: 32 }, (_, i) => `probe chunk ${i}`);
                const t1 = Date.now();
                await model(probe, { pooling: 'mean', normalize: true });
                await model(probe, { pooling: 'mean', normalize: true });
                const tEmbed = Date.now() - t1;
                return { device, dtype, load_ms: tLoad, warm_batch32_ms: tEmbed };
            } catch (e) {
                continue;
            }
        }
    }
    throw new Error('No execution provider could load the model');
}

async function run() {
    console.log('codebasesearch setup — probing accelerators and pre-downloading model');
    console.log('Model: Xenova/all-MiniLM-L6-v2 (~90MB)\n');

    const result = await detectBestDevice();
    const perItem = (result.warm_batch32_ms / 32).toFixed(2);

    console.log(`✓ Model cached`);
    console.log(`✓ Best backend: device=${result.device} dtype=${result.dtype}`);
    console.log(`  load:    ${result.load_ms}ms (one-time)`);
    console.log(`  warm:    ${result.warm_batch32_ms}ms for batch of 32 (${perItem}ms/item)`);
    console.log(`\nTo override at runtime:`);
    console.log(`  CODEBASESEARCH_DEVICE=${result.device} CODEBASESEARCH_DTYPE=${result.dtype}`);
    console.log(`\nReady. Run 'codebasesearch <query>' in any repo.`);
}

run().catch(err => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
