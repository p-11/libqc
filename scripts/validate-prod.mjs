import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const DIST = 'dist';
const errors = [];

function fail(msg) {
  errors.push(msg);
}

if (!existsSync(DIST)) {
  fail('dist/ directory missing - run pnpm build:prod first');
  report();
  process.exit(1);
}

if (!existsSync(join(DIST, 'index.js'))) {
  fail('dist/index.js missing - main entry point not emitted');
}

if (!existsSync(join(DIST, 'index.d.ts'))) {
  fail('dist/index.d.ts missing - type declarations not emitted');
}

const jsFiles = readdirSync(DIST, { recursive: true }).filter(
  f => String(f).endsWith('.js') && statSync(join(DIST, String(f))).size > 0
);

if (jsFiles.length === 0) {
  fail('no non-empty JS files found in dist/');
}

function report() {
  if (errors.length === 0) {
    console.log(
      `validate:prod passed (index.js, index.d.ts, ${jsFiles.length} JS file(s))`
    );
  } else {
    for (const e of errors) console.error(`ERROR: ${e}`);
  }
}

report();
if (errors.length > 0) process.exit(1);
