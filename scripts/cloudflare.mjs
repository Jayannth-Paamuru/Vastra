import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const wranglerBin = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const wranglerTomlPath = path.join(projectRoot, 'wrangler.toml');
const schemaPath = path.join(projectRoot, 'database', 'schema.sql');
const deployDir = path.join(projectRoot, 'deploy-folder');

const PROJECT_NAME = 'boutique-inventory-manager';
const DB_NAME = 'boutique-inventory-manager-db';

if (!fs.existsSync(wranglerBin)) {
  console.error('Local Wrangler binary not found. Run `npm install` first.');
  process.exit(1);
}

function runWrangler(args, { capture = false, allowFail = false, input = undefined } = {}) {
  const res = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    input,
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : [input !== undefined ? 'pipe' : 'inherit', 'inherit', 'inherit']
  });

  if (res.status !== 0 && !allowFail) {
    if (capture) {
      if (res.stdout) console.error(res.stdout);
      if (res.stderr) console.error(res.stderr);
    }
    process.exit(res.status ?? 1);
  }
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHiddenSecret(promptText) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(promptText);

    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin });
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let secret = '';
    const onData = (ch) => {
      if (ch === '\u0003') {
        stdout.write('\n');
        stdin.setRawMode(false);
        process.exit(1);
      }
      if (ch === '\r' || ch === '\n') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        resolve(secret.trim());
        return;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (secret.length > 0) {
          secret = secret.slice(0, -1);
          stdout.write('\b \b');
        }
        return;
      }
      secret += ch;
      stdout.write('*');
    };

    stdin.on('data', onData);
  });
}

function updateWranglerDatabaseId(databaseId) {
  const current = fs.readFileSync(wranglerTomlPath, 'utf8');
  const updated = current.replace(
    /database_id\s*=\s*"[^"]*"/,
    `database_id = "${databaseId}"`
  );
  fs.writeFileSync(wranglerTomlPath, updated, 'utf8');
  console.log(`Updated wrangler.toml with database_id = ${databaseId}`);
}

function ensureD1Database() {
  console.log(`Checking D1 database "${DB_NAME}"...`);
  const listRes = runWrangler(['d1', 'list', '--json'], { capture: true, allowFail: true });
  if (listRes.status === 0 && listRes.stdout) {
    try {
      const dbs = JSON.parse(listRes.stdout);
      const existing = dbs.find((d) => d.name === DB_NAME);
      if (existing?.uuid) {
        console.log(`Reusing existing D1 database: ${existing.name} (${existing.uuid})`);
        return existing.uuid;
      }
    } catch {
      // Fallback to creation below
    }
  }

  console.log(`Creating D1 database "${DB_NAME}"...`);
  const createRes = runWrangler(['d1', 'create', DB_NAME], { capture: true, allowFail: true });
  const combined = `${createRes.stdout || ''}\n${createRes.stderr || ''}`;
  const match = combined.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i) || combined.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (match?.[1]) {
    return match[1];
  }

  const retryList = runWrangler(['d1', 'list', '--json'], { capture: true });
  const dbs = JSON.parse(retryList.stdout || '[]');
  const found = dbs.find((d) => d.name === DB_NAME);
  if (!found?.uuid) {
    console.error('Could not resolve D1 database_id.');
    console.error(combined);
    process.exit(1);
  }
  return found.uuid;
}

async function ensurePagesProject() {
  console.log(`Ensuring Cloudflare Pages project "${PROJECT_NAME}" exists...`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = runWrangler(
      ['pages', 'project', 'create', PROJECT_NAME, '--production-branch=main'],
      { capture: true, allowFail: true }
    );
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    if (res.status === 0 || /already exists/i.test(out) || /8000007/.test(out)) {
      console.log(`Pages project "${PROJECT_NAME}" is ready.`);
      return;
    }
    if (attempt < 3) {
      console.log(`Retrying Pages project creation (attempt ${attempt + 1}/3)...`);
      await sleep(2500);
    } else {
      console.error(out);
      process.exit(1);
    }
  }
}

function applySchema(remote = true) {
  const modeFlag = remote ? '--remote' : '--local';
  console.log(`Applying database/schema.sql (${modeFlag})...`);
  runWrangler(['d1', 'execute', DB_NAME, modeFlag, '--file', schemaPath, '--yes']);
}

function buildProject() {
  const buildScript = path.join(projectRoot, 'scripts', 'build.mjs');
  const res = spawnSync(process.execPath, [buildScript], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

function deployPages() {
  console.log(`Deploying ${path.relative(projectRoot, deployDir)} to Cloudflare Pages...`);
  const res = runWrangler(
    ['pages', 'deploy', deployDir, '--project-name', PROJECT_NAME, '--branch', 'main'],
    { capture: true }
  );
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  const urls = combined.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/gi) || [];
  const prodUrl = `https://${PROJECT_NAME}.pages.dev`;
  return urls.includes(prodUrl) ? prodUrl : urls[urls.length - 1] || prodUrl;
}

async function verifyHealth(baseUrl) {
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;
  console.log(`Checking live health endpoint: ${healthUrl}`);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(healthUrl, {
        headers: { Accept: 'application/json' }
      });
      const data = await response.json();
      console.log('Health response:', JSON.stringify(data));
      if (response.ok && data?.database === true) {
        return data;
      }
    } catch {
      // Wait for edge propagation
    }
    await sleep(3000);
  }
  console.warn('Health check did not confirm database: true within retry window. Run `npm run cf:status` shortly.');
  return null;
}

const command = process.argv[2];
const extraArgs = process.argv.slice(3);

switch (command) {
  case 'login': {
    const child = spawn(process.execPath, [wranglerBin, 'login'], {
      cwd: projectRoot,
      stdio: 'inherit'
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    break;
  }

  case 'whoami': {
    runWrangler(['whoami']);
    break;
  }

  case 'schema': {
    const isLocal = extraArgs.includes('--local');
    applySchema(!isLocal);
    break;
  }

  case 'deploy': {
    buildProject();
    const url = deployPages();
    console.log(`Live URL: ${url}`);
    await verifyHealth(url);
    break;
  }

  case 'setup': {
    console.log('Verifying Cloudflare authentication...');
    runWrangler(['whoami']);
    const dbId = ensureD1Database();
    updateWranglerDatabaseId(dbId);
    applySchema(true);
    await ensurePagesProject();
    buildProject();
    const url = deployPages();
    console.log(`\nSetup & Deployment complete!\nLive URL: ${url}`);
    await verifyHealth(url);
    break;
  }

  case 'secrets': {
    console.log('Set SESSION_SECRET for VastraLedger (minimum 32 random characters recommended).');
    console.log('Your input is hidden and will never be printed or saved locally.\n');
    const secret = await readHiddenSecret('Enter SESSION_SECRET: ');
    if (secret.length < 16) {
      console.error('SESSION_SECRET must be at least 16 characters long.');
      process.exit(1);
    }

    const res = runWrangler(
      ['pages', 'secret', 'put', 'SESSION_SECRET', '--project-name', PROJECT_NAME],
      { input: `${secret}\n` }
    );
    if (res.status === 0) {
      console.log('SESSION_SECRET saved. Redeploying so the secret binds to the live site...');
      const url = deployPages();
      await verifyHealth(url);
    }
    break;
  }

  case 'status': {
    runWrangler(['whoami']);
    const targetUrl = extraArgs[0] || `https://${PROJECT_NAME}.pages.dev`;
    await verifyHealth(targetUrl);
    break;
  }

  default: {
    console.log('Usage: node scripts/cloudflare.mjs <login|whoami|setup|deploy|secrets|schema|status>');
    process.exit(1);
  }
}
