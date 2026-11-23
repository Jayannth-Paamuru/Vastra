import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const deployDir = path.join(projectRoot, 'deploy-folder');

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('1/4 Generating PWA PNG icons...');
runNodeScript(path.join(projectRoot, 'scripts', 'generate-icons.mjs'));

console.log('2/4 Building React SPA with Vite...');
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
runNodeScript(viteBin, ['build']);

console.log('3/4 Bundling Cloudflare Pages Worker (_worker.js) via esbuild...');
await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src', 'worker', 'index.js')],
  outfile: path.join(deployDir, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  conditions: ['worker', 'browser', 'module', 'default'],
  minify: true,
  sourcemap: false,
  legalComments: 'none'
});

console.log('4/4 Auditing deploy-folder for clean output...');
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const builtFiles = walk(deployDir).map((f) => path.relative(deployDir, f));
const forbidden = builtFiles.filter(
  (f) =>
    f.endsWith('.ts') ||
    f.endsWith('.tsx') ||
    f.includes('.test.') ||
    f.includes('.env') ||
    f.includes('.dev.vars')
);

if (forbidden.length > 0) {
  console.error('Build check failed — unexpected files in deploy-folder:', forbidden);
  process.exit(1);
}

if (!builtFiles.includes('_worker.js') || !builtFiles.includes('index.html')) {
  console.error('Build check failed — missing _worker.js or index.html in deploy-folder.');
  process.exit(1);
}

console.log(`Build complete (${builtFiles.length} output files in deploy-folder).`);
