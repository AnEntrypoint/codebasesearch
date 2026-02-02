import { Worker } from 'worker_threads';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class WorkerSupervisor {
  constructor() {
    this.worker = null;
    this.restartDelay = 1000;
    this.failureCount = 0;
    this.requestQueue = new Map();
    this.requestId = 0;
    this.healthCheckInterval = null;
    this.startWorker();
  }

  startWorker() {
    try {
      const workerPath = resolve(__dirname, 'search-worker.js');
      this.worker = new Worker(workerPath);

      this.worker.on('message', this.handleMessage.bind(this));
      this.worker.on('error', (err) => {
        console.error('[Supervisor] Worker error:', err.message);
        this.scheduleRestart();
      });
      this.worker.on('exit', (code) => {
        console.error('[Supervisor] Worker exited with code:', code);
        this.worker = null;
        if (code !== 0) {
          this.failureCount++;
          this.scheduleRestart();
        }
      });

      this.restartDelay = 1000;
      this.failureCount = 0;
      console.error('[Supervisor] Worker started');
      this.setupHealthCheck();
    } catch (e) {
      console.error('[Supervisor] Worker start failed:', e.message);
      this.scheduleRestart();
    }
  }

  setupHealthCheck() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = setInterval(() => {
      if (this.worker) {
        try {
          this.worker.postMessage({ type: 'health-check', id: -1 });
        } catch (e) {
          console.error('[Supervisor] Health check failed:', e.message);
        }
      }
    }, 30000);
  }

  scheduleRestart() {
    const delay = Math.min(this.restartDelay, 60000);
    console.error('[Supervisor] Restart scheduled in', delay, 'ms');
    setTimeout(() => {
      if (!this.worker) {
        this.startWorker();
      }
    }, delay);
    this.restartDelay = Math.min(this.restartDelay * 2, 60000);
  }

  async sendRequest(data) {
    if (!this.worker) {
      return { error: 'Worker unavailable, restarting...', results: [] };
    }

    return new Promise((resolve) => {
      const id = this.requestId++;
      const resolveWrapper = resolve;

      const timeout = setTimeout(() => {
        if (this.requestQueue.has(id)) {
          this.requestQueue.delete(id);
          resolveWrapper({ error: 'Request timeout', results: [] });
        }
      }, 600000);

      this.requestQueue.set(id, (result) => {
        clearTimeout(timeout);
        resolveWrapper(result);
      });

      try {
        this.worker.postMessage({ id, ...data });
      } catch (e) {
        clearTimeout(timeout);
        this.requestQueue.delete(id);
        resolveWrapper({ error: 'Worker communication failed', results: [] });
        this.scheduleRestart();
      }
    });
  }

  handleMessage(msg) {
    if (msg.id === -1) return;

    const resolve = this.requestQueue.get(msg.id);
    if (resolve) {
      this.requestQueue.delete(msg.id);
      resolve(msg.result || msg);
    }
  }

  shutdown() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (e) {}
      this.worker = null;
    }
  }
}

export const supervisor = new WorkerSupervisor();
