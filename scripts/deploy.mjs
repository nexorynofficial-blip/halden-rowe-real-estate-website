// One-command deploy to Vercel.
//
//   npm run deploy -- halden-rowe-demo
//   BRAND=calder-sloane npm run deploy -- calder-sloane-demo
//   npm run deploy -- halden-rowe-demo --scope my-team     (if you belong to several Vercel teams)
//
// The first argument is the Vercel project name, which becomes the address:
//   https://<project-name>.vercel.app
// The site is built for that address (canonical links, link previews, sitemap), then the finished
// files are uploaded together with vercel.json, which carries the security headers and caching.
// You must be signed in once beforehand:  npx vercel login
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [name, ...extra] = process.argv.slice(2);
if (!name || name.startsWith('--')) {
  console.error('Usage: npm run deploy -- <vercel-project-name> [--scope <team>]');
  process.exit(1);
}
const address = `https://${name}.vercel.app`;
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { shell: true, encoding: 'utf8', ...opts });

console.log(`\n1/3 Building for ${address} (brand: ${process.env.BRAND || 'halden-rowe'})`);
const build = run('npx', ['astro', 'build'], { stdio: 'inherit', env: { ...process.env, SITE_URL: process.env.SITE_URL || address } });
if (build.status !== 0) process.exit(build.status ?? 1);

console.log('\n2/3 Staging files');
const stage = mkdtempSync(join(tmpdir(), 'site-deploy-'));
cpSync('dist', stage, { recursive: true });
if (existsSync('vercel.json')) {
  // The staged folder is already built, so drop the build settings that only matter for Git builds.
  const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
  for (const key of ['framework', 'buildCommand', 'installCommand', 'outputDirectory']) delete cfg[key];
  writeFileSync(join(stage, 'vercel.json'), JSON.stringify(cfg, null, 2));
}

console.log('\n3/3 Uploading to Vercel (production)');
const deploy = run('npx', ['vercel@latest', 'deploy', `"${stage}"`, '--prod', '--yes', '--project', name, '--create-if-missing', ...extra], { stdio: ['inherit', 'pipe', 'inherit'] });
process.stdout.write(deploy.stdout ?? '');
rmSync(stage, { recursive: true, force: true });
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const live = (deploy.stdout ?? '').match(/Production URL: (https:\/\/[^\s"]+)/)?.[1];
console.log(`\nLive at: ${live ?? address}`);
if (live && live.replace(/\/$/, '') !== address) {
  console.warn(`Note: Vercel assigned ${live} because ${address} was not available. Rerun with SITE_URL=${live} so links and previews use the real address.`);
}
