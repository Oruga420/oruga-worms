#!/usr/bin/env node
// Placeholder for npm scripts whose tools are not built yet (ultraplan.html Phases 1F, 1G and 4).
// Fails loudly with exit 1 so nothing downstream mistakes a missing tool for a passing step.

const PHASE_BY_SCRIPT = Object.freeze({
  'assets:generate': 'Phase 1F asset loop (tools/assets/generate.ts)',
  'audio:generate': 'Phase 1G sound loop (tools/audio/generate.ts)',
  'verify:manifest': 'Phase 4 verification (tools/verify-manifest.ts)',
});

const name = process.argv[2] ?? 'unknown script';
const phase = PHASE_BY_SCRIPT[name] ?? 'a later phase';
console.error(`${name}: not implemented yet, planned for ${phase}`);
process.exit(1);
