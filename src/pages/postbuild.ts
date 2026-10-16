import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAllowedOrigin, renderHeaders } from './headers.ts'
import { devPageFiles } from './devPageFiles.ts'

// Runs after `vite build` for Cloudflare Pages (a tool's `npm run build:pages`):
// 1. writes dist/_headers with CORS for the one shell origin in REMOTE_ALLOWED_ORIGIN,
//    and fails the build if it is missing or not a public https origin;
// 2. removes dist/index.html, the standalone dev page (it cannot run without the shell), and the
//    JavaScript files only that page uses, so the deployment serves only the remote and
//    dist/404.html.
// A top-level 404.html also turns off Pages' single-page-app fallback, so a missing chunk
// gets a real 404 instead of an HTML page with status 200.

export class PostbuildError extends Error {}

/** Checks and prepares a tool's `dist` for Pages; throws PostbuildError with the reason. Returns a summary line. */
export function runPostbuild(dist: string, allowedOrigin: string | undefined): string {
  const fail = (message: string): never => {
    throw new PostbuildError(message)
  }
  const checked = checkAllowedOrigin(allowedOrigin)
  if ('problem' in checked) fail(checked.problem)
  const { origin } = checked as { origin: string }

  for (const file of ['remoteEntry.js', '404.html']) {
    if (!existsSync(join(dist, file))) fail(`dist/${file} is missing; run vite build first`)
  }
  if (!existsSync(join(dist, 'assets')) || !readdirSync(join(dist, 'assets')).some((name) => name.endsWith('.js'))) fail('dist/assets has no JavaScript chunks')

  const indexPath = join(dist, 'index.html')
  const devFiles = existsSync(indexPath)
    ? devPageFiles(
        readFileSync(indexPath, 'utf8'),
        Object.fromEntries(['remoteEntry.js', ...readdirSync(join(dist, 'assets')).filter((n) => n.endsWith('.js')).map((n) => `assets/${n}`)].map((p) => [p, readFileSync(join(dist, p), 'utf8')])),
      )
    : []
  for (const file of devFiles) rmSync(join(dist, file))
  rmSync(indexPath, { force: true })
  writeFileSync(join(dist, '_headers'), renderHeaders(origin))
  return `dist/_headers allows ${origin}; dist/index.html removed${devFiles.length ? ` with ${devFiles.join(', ')}` : ''}`
}
