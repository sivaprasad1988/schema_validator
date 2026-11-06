#!/usr/bin/env node
// Builds unpacked extensions into dist/<browser>/ from src/ and manifests/<browser>.json.
// Usage: node scripts/build.mjs [chrome|firefox]   (no argument = both)
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const targets = process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox'];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (!existsSync(join(root, 'src', 'vocab.json'))) {
  console.error('src/vocab.json missing. Run "npm run update-vocab" first.');
  process.exit(1);
}

for (const target of targets) {
  const manifestFile = join(root, 'manifests', `${target}.json`);
  if (!existsSync(manifestFile)) {
    console.error(`Unknown target "${target}".`);
    process.exit(1);
  }
  const out = join(root, 'dist', target);
  rmSync(out, { recursive: true, force: true });
  cpSync(join(root, 'src'), out, { recursive: true });

  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.version = pkg.version;
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${target} -> ${out}`);
}
