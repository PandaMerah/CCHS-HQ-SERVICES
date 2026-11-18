#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const E2E_DIR = __dirname;
const TIER_FILES = {
  '1': path.join(E2E_DIR, 'tier1.test.js'),
  '2': path.join(E2E_DIR, 'tier2.test.js'),
  '3': path.join(E2E_DIR, 'tier3.test.js'),
  '4': path.join(E2E_DIR, 'tier4.test.js')
};

function parseArgs(argv) {
  const tiers = [];
  let reporter = 'spec';
  let timeoutMs = 240000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node tests/e2e/run.js [--tier 1|2|3|4] [--reporter spec|tap] [--timeout <ms>]');
      process.exit(0);
    }
    if (arg === '--tier' && argv[i + 1]) {
      for (const t of argv[++i].split(',')) {
        const clean = t.trim();
        if (TIER_FILES[clean]) tiers.push(clean);
        else {
          console.error(`Unknown tier: "${clean}". Valid tiers are 1, 2, 3, 4.`);
          process.exit(2);
        }
      }
    } else if (arg.startsWith('--tier=')) {
      for (const t of arg.slice('--tier='.length).split(',')) {
        const clean = t.trim();
        if (TIER_FILES[clean]) tiers.push(clean);
        else {
          console.error(`Unknown tier: "${clean}". Valid tiers are 1, 2, 3, 4.`);
          process.exit(2);
        }
      }
    } else if (arg === '--reporter' && argv[i + 1]) {
      reporter = argv[++i];
    } else if (arg === '--timeout' && argv[i + 1]) {
      timeoutMs = Number(argv[++i]) || 240000;
    }
  }

  const selectedTiers = tiers.length > 0 ? tiers : ['1', '2', '3', '4'];
  return {
    files: selectedTiers.map((t) => TIER_FILES[t]),
    selectedTiers,
    reporter,
    timeoutMs
  };
}

function main() {
  const { files, selectedTiers, reporter, timeoutMs } = parseArgs(process.argv.slice(2));
  console.log(`Running Careclinics HQ E2E Test Suite (Tiers: ${selectedTiers.join(', ')})`);

  const nodeArgs = [
    '--test',
    `--test-reporter=${reporter}`,
    `--test-timeout=${timeoutMs}`,
    '--test-concurrency=1',
    ...files
  ];

  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: path.resolve(E2E_DIR, '..', '..'),
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    console.error('Failed to run node --test:', result.error);
    process.exit(1);
  }
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

main();
