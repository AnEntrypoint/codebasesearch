import { pipeline } from '@huggingface/transformers';
import { rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const DEVICE_PREFERENCE = (process.env.CODEBASESEARCH_DEVICE || 'auto').toLowerCase();
const DTYPE_PREFERENCE = (process.env.CODEBASESEARCH_DTYPE || 'auto').toLowerCase();
const DEVICE_ID_OVERRIDE = process.env.CODEBASESEARCH_DEVICE_ID !== undefined
    ? Number(process.env.CODEBASESEARCH_DEVICE_ID) : null;
const DEVICE_ORDER = ['cuda', 'dml', 'webgpu', 'wasm'];
const DML_MAX_ADAPTERS = 8;
const PROBE_TEXT = 'medical cardiac arrhythmia diagnosis evaluation treatment protocol summary '.repeat(8);
const PROBE_BATCH = 16;
const CACHE_FILE = join(homedir(), '.cache', 'codebasesearch', 'device.json');

function readDeviceCache() {
    try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return null; }
}

function writeDeviceCache(obj) {
    try {
        mkdirSync(dirname(CACHE_FILE), { recursive: true });
        writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2));
    } catch {}
}

let modelCache = null;
let cacheCleared = false;
let modelLoadTime = 0;
let resolvedDevice = null;
let resolvedDtype = null;
let resolvedDeviceId = null;

function clearModelCache() {
    const cacheDirs = [
        join(homedir(), '.cache', 'huggingface', 'transformers'),
        join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache'),
    ];
    for (const cacheDir of cacheDirs) {
        try {
            if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
        } catch {}
    }
    console.error('Cleared corrupted model cache');
}

function candidateDevices() {
    if (DEVICE_PREFERENCE !== 'auto') return [DEVICE_PREFERENCE, 'wasm'];
    return DEVICE_ORDER;
}

async function tryLoadWith(device, dtype, deviceId) {
    const options = { device };
    if (dtype && dtype !== 'auto') options.dtype = dtype;
    if (device === 'dml' && deviceId !== null && deviceId !== undefined) {
        options.session_options = { executionProviders: [{ name: 'dml', deviceId }] };
    }
    return await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', options);
}

async function benchModel(model) {
    const batch = Array.from({ length: PROBE_BATCH }, () => PROBE_TEXT);
    await model(batch, { pooling: 'mean', normalize: true });
    const t0 = performance.now();
    await model(batch, { pooling: 'mean', normalize: true });
    return (performance.now() - t0) / PROBE_BATCH;
}

async function probeBestDmlAdapter(dtype) {
    if (DEVICE_ID_OVERRIDE !== null) {
        const model = await tryLoadWith('dml', dtype, DEVICE_ID_OVERRIDE);
        return { model, deviceId: DEVICE_ID_OVERRIDE, msPerItem: null };
    }
    let best = null;
    for (let deviceId = 0; deviceId < DML_MAX_ADAPTERS; deviceId++) {
        try {
            const model = await tryLoadWith('dml', dtype, deviceId);
            const msPerItem = await benchModel(model);
            console.error(`  dml deviceId=${deviceId}: ${msPerItem.toFixed(2)} ms/item`);
            if (!best || msPerItem < best.msPerItem) best = { model, deviceId, msPerItem };
        } catch (e) {
            if (e.message.includes('adapter') || e.message.includes('deviceId') || e.message.includes('DXGI')) break;
        }
    }
    if (!best) throw new Error('No DML adapter available');
    return best;
}

async function loadFromCache() {
    if (DEVICE_PREFERENCE !== 'auto' || DTYPE_PREFERENCE !== 'auto' || DEVICE_ID_OVERRIDE !== null) return null;
    const cached = readDeviceCache();
    if (!cached || !cached.device || !cached.dtype) return null;
    try {
        console.error(`Using cached backend: ${cached.device}${cached.deviceId !== undefined ? `:${cached.deviceId}` : ''} (${cached.dtype})`);
        const t0 = performance.now();
        const model = await tryLoadWith(cached.device, cached.dtype, cached.deviceId);
        modelLoadTime = performance.now() - t0;
        resolvedDevice = cached.device;
        resolvedDtype = cached.dtype;
        resolvedDeviceId = cached.deviceId ?? null;
        return model;
    } catch (e) {
        console.error(`Cached backend failed (${e.message}); re-probing.`);
        return null;
    }
}

async function loadModel() {
    const cached = await loadFromCache();
    if (cached) return cached;

    const devices = candidateDevices();
    const dtypes = DTYPE_PREFERENCE === 'auto' ? ['fp32', 'q8'] : [DTYPE_PREFERENCE];
    const errors = [];
    for (const device of devices) {
        for (const dtype of dtypes) {
            try {
                console.error(`Loading embeddings model on device=${device} dtype=${dtype}...`);
                const t0 = performance.now();
                let model, deviceId = null;
                if (device === 'dml') {
                    const probe = await probeBestDmlAdapter(dtype);
                    model = probe.model;
                    deviceId = probe.deviceId;
                    console.error(`  selected dml deviceId=${deviceId} (${probe.msPerItem?.toFixed(2) ?? '?'} ms/item probe)`);
                } else {
                    model = await tryLoadWith(device, dtype);
                }
                modelLoadTime = performance.now() - t0;
                resolvedDevice = device;
                resolvedDtype = dtype;
                resolvedDeviceId = deviceId;
                writeDeviceCache({ device, dtype, deviceId, cachedAt: new Date().toISOString() });
                console.error(`Model ready on ${device}${deviceId !== null ? `:${deviceId}` : ''} (${dtype}) in ${modelLoadTime.toFixed(0)}ms`);
                return model;
            } catch (e) {
                errors.push(`${device}/${dtype}: ${e.message}`);
            }
        }
    }
    throw new Error('All device/dtype combinations failed:\n' + errors.join('\n'));
}

async function getModel(retryOnError = true) {
    if (modelCache) return modelCache;
    try {
        modelCache = await loadModel();
    } catch (e) {
        if (retryOnError && !cacheCleared && /Protobuf|parsing|corrupt/i.test(e.message)) {
            cacheCleared = true;
            clearModelCache();
            modelCache = null;
            return getModel(false);
        }
        console.error('Error loading model:', e.message);
        throw e;
    }
    return modelCache;
}

export function getModelLoadTime() { return modelLoadTime; }
export function getResolvedDevice() { return resolvedDevice; }
export function getResolvedDtype() { return resolvedDtype; }
export function getResolvedDeviceId() { return resolvedDeviceId; }

export async function generateEmbeddings(texts) {
    const model = await getModel();
    if (!Array.isArray(texts)) texts = [texts];

    const embeddings = await Promise.race([
        model(texts, { pooling: 'mean', normalize: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Embedding generation timeout')), 120000))
    ]);

    const result = [];
    if (embeddings && embeddings.data) {
        const data = embeddings.data;
        const shape = embeddings.dims;
        if (shape && shape.length === 2) {
            const [batchSize, embeddingDim] = shape;
            for (let i = 0; i < batchSize; i++) {
                result.push(Array.from(data.subarray(i * embeddingDim, (i + 1) * embeddingDim)));
            }
        } else {
            result.push(Array.from(data));
        }
    } else if (Array.isArray(embeddings)) {
        for (const emb of embeddings) {
            if (emb.data) result.push(Array.from(emb.data));
            else result.push(Array.from(emb));
        }
    }
    return result;
}

export async function generateSingleEmbedding(text) {
    const e = await generateEmbeddings([text]);
    return e[0];
}
