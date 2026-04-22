#!/usr/bin/env node

import { pipeline } from '@huggingface/transformers';
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const CACHE_FILE = join(homedir(), '.cache', 'codebasesearch', 'device.json');

const DEVICES = ['cuda', 'dml', 'webgpu', 'cpu'];
const DTYPES = ['fp32', 'q8'];
const DML_MAX_ADAPTERS = 8;
const PROBE_TEXT = 'medical cardiac arrhythmia diagnosis evaluation treatment protocol summary '.repeat(8);
const PROBE_BATCH = 16;

async function benchModel(model) {
    const batch = Array.from({ length: PROBE_BATCH }, () => PROBE_TEXT);
    await model(batch, { pooling: 'mean', normalize: true });
    const t = Date.now();
    await model(batch, { pooling: 'mean', normalize: true });
    return (Date.now() - t) / PROBE_BATCH;
}

async function probeDmlAdapters(dtype) {
    const results = [];
    for (let deviceId = 0; deviceId < DML_MAX_ADAPTERS; deviceId++) {
        try {
            const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                device: 'dml', dtype,
                session_options: { executionProviders: [{ name: 'dml', deviceId }] },
            });
            const msPerItem = await benchModel(model);
            results.push({ deviceId, msPerItem });
        } catch (e) {
            if (e.message.includes('adapter') || e.message.includes('deviceId') || e.message.includes('DXGI')) break;
        }
    }
    return results;
}

async function detectBestBackend() {
    for (const device of DEVICES) {
        for (const dtype of DTYPES) {
            try {
                if (device === 'dml') {
                    const adapters = await probeDmlAdapters(dtype);
                    if (!adapters.length) continue;
                    const best = adapters.reduce((a, b) => (a.msPerItem < b.msPerItem ? a : b));
                    return { device, dtype, adapters, best };
                }
                const model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device, dtype });
                const msPerItem = await benchModel(model);
                return { device, dtype, best: { msPerItem } };
            } catch {}
        }
    }
    throw new Error('No execution provider could load the model');
}

async function run() {
    console.log('codebasesearch setup — probing accelerators and pre-downloading model');
    console.log('Model: Xenova/all-MiniLM-L6-v2 (~90MB)\n');

    const { device, dtype, adapters, best } = await detectBestBackend();

    console.log(`✓ Model cached`);
    if (adapters) {
        console.log(`✓ DML adapter probe:`);
        for (const a of adapters) {
            const mark = a.deviceId === best.deviceId ? '←' : ' ';
            console.log(`    deviceId=${a.deviceId}: ${a.msPerItem.toFixed(2)} ms/item ${mark}`);
        }
    }
    console.log(`✓ Best backend: device=${device}${best.deviceId !== undefined ? `:${best.deviceId}` : ''} dtype=${dtype}`);
    console.log(`  throughput: ${best.msPerItem.toFixed(2)} ms/item (batch=${PROBE_BATCH}, probe text)`);

    try {
        mkdirSync(dirname(CACHE_FILE), { recursive: true });
        writeFileSync(CACHE_FILE, JSON.stringify({ device, dtype, deviceId: best.deviceId ?? null, cachedAt: new Date().toISOString() }, null, 2));
        console.log(`✓ Cached selection to ${CACHE_FILE}`);
    } catch (e) {
        console.log(`  (warn: failed to cache selection: ${e.message})`);
    }

    console.log(`\nTo override at runtime:`);
    console.log(`  CODEBASESEARCH_DEVICE=${device} CODEBASESEARCH_DTYPE=${dtype}${best.deviceId !== undefined ? ` CODEBASESEARCH_DEVICE_ID=${best.deviceId}` : ''}`);
    console.log(`\nReady. Run 'codebasesearch <query>' in any repo.`);
}

run().catch(err => {
    console.error('Setup failed:', err.message);
    process.exit(1);
});
