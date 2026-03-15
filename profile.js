#!/usr/bin/env node

import { existsSync } from 'fs';
import { loadIgnorePatterns } from './src/ignore-parser.js';
import { scanRepository } from './src/scanner.js';
import { buildTextIndex, searchText } from './src/text-search.js';

const CODEBASES = [
  '~/workspace/agentauth',
  '~/workspace/agentgui',
  '~/workspace/docmcp',
  '~/workspace/friday-staging',
  '~/workspace/fsbrowse',
  '~/workspace/gmweb',
  '~/workspace/hookie',
  '~/workspace/invoic',
  '~/workspace/mcp-thorns',
  '~/workspace/models',
  '~/workspace/moonlanding',
  '~/workspace/myworkreview-staging',
  '~/workspace/opencode-source',
  '~/workspace/plugforge',
  '~/workspace/pp',
  '~/workspace/proxypilot-setup',
  '~/workspace/seqos',
  '~/workspace/sttttsmodels',
  '~/workspace/teatree',
  '~/workspace/webtalk',
  '~/workspace/webtalk-repo',
  '~/workspace/xbot',
  '~/workspace/zellous',
  '~/docstudio',
];

// Realistic queries that represent actual usage
const TEST_QUERIES = [
  'authentication',
  'database connection',
  'error handling',
  'HTTP request',
  'user session',
];

class Profiler {
  constructor() {
    this.marks = {};
    this.measurements = [];
  }

  start(name) {
    this.marks[name] = performance.now();
  }

  end(name, extra = null) {
    if (!this.marks[name]) return 0;
    const duration = performance.now() - this.marks[name];
    this.measurements.push({ name, duration, extra });
    delete this.marks[name];
    return duration;
  }

  report(results) {
    console.log('\n' + '='.repeat(80));
    console.log('PERFORMANCE SUMMARY');
    console.log('='.repeat(80));

    const scanTimes = this.measurements.filter(m => m.name.startsWith('scan:'));
    const indexTimes = this.measurements.filter(m => m.name.startsWith('index:'));
    const searchTimes = this.measurements.filter(m => m.name.startsWith('search:'));

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const fmt = ms => ms.toFixed(1) + 'ms';

    console.log(`\nScan:   avg ${fmt(avg(scanTimes.map(m => m.duration)))}  max ${fmt(Math.max(...scanTimes.map(m => m.duration)))}`);
    console.log(`Index:  avg ${fmt(avg(indexTimes.map(m => m.duration)))}  max ${fmt(Math.max(...indexTimes.map(m => m.duration)))}`);
    console.log(`Search: avg ${fmt(avg(searchTimes.map(m => m.duration)))}  max ${fmt(Math.max(...searchTimes.map(m => m.duration)))}`);

    console.log('\n' + '-'.repeat(80));
    console.log('PER-CODEBASE RESULTS');
    console.log('-'.repeat(80));

    for (const r of results) {
      if (r.skipped) {
        console.log(`\n${r.label}: skipped (not found)`);
        continue;
      }
      const scanT = scanTimes.find(m => m.name === `scan:${r.label}`)?.duration || 0;
      const indexT = indexTimes.find(m => m.name === `index:${r.label}`)?.duration || 0;
      console.log(`\n${r.label} (${r.chunks} chunks): scan ${fmt(scanT)} | index ${fmt(indexT)}`);
      for (const q of r.queries) {
        const top = q.results[0];
        const topStr = top ? `${top.file_path}:${top.line_start} (${(top.score * 100).toFixed(0)}%)` : 'no results';
        console.log(`  "${q.query}" → ${q.count} results in ${fmt(q.time)} | top: ${topStr}`);
      }
    }
  }
}

async function profileCodebase(codebasePath, profiler) {
  const rootPath = codebasePath.replace('~', process.env.HOME);
  const label = codebasePath.split('/').pop();

  if (!existsSync(rootPath)) {
    console.log(`  ${label}: not found, skipping`);
    return { label, skipped: true };
  }

  process.stdout.write(`▶ ${label}... `);

  profiler.start(`scan:${label}`);
  const ignorePatterns = loadIgnorePatterns(rootPath);
  const chunks = scanRepository(rootPath, ignorePatterns);
  profiler.end(`scan:${label}`, chunks.length);

  if (chunks.length === 0) {
    console.log('0 chunks');
    return { label, chunks: 0, queries: [] };
  }

  profiler.start(`index:${label}`);
  const indexData = buildTextIndex(chunks);
  profiler.end(`index:${label}`, chunks.length);

  const queryResults = [];
  for (const query of TEST_QUERIES) {
    const t0 = performance.now();
    const results = searchText(query, chunks, indexData);
    const elapsed = performance.now() - t0;
    profiler.measurements.push({ name: `search:${label}:${query}`, duration: elapsed });
    queryResults.push({ query, count: results.length, time: elapsed, results: results.slice(0, 1) });
  }

  console.log(`${chunks.length} chunks, ${queryResults.map(q => q.time.toFixed(0) + 'ms').join('/')}`);
  return { label, chunks: chunks.length, queries: queryResults };
}

async function main() {
  console.log('Profiling search across codebases...\n');

  const profiler = new Profiler();
  const results = [];

  for (const codebase of CODEBASES) {
    results.push(await profileCodebase(codebase, profiler));
  }

  profiler.report(results);
}

main().catch(err => {
  console.error('Profile error:', err.message);
  process.exit(1);
});
