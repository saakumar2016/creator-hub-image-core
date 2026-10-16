import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PostbuildError, runPostbuild } from './postbuild.ts'

// A tool's dist/ after `vite build`: the remote, a 404 page and the standalone dev page.
let dist: string
function build() {
  dist = mkdtempSync(join(tmpdir(), 'postbuild-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'remoteEntry.js'), 'import("./assets/Workspace-W1.js")')
  writeFileSync(join(dist, '404.html'), '<p>Not found</p>')
  writeFileSync(join(dist, 'assets/Workspace-W1.js'), 'export default 1')
  writeFileSync(join(dist, 'assets/mf-entry-bootstrap-0-abc.js'), 'import("./index-D1.js")')
  writeFileSync(join(dist, 'assets/index-D1.js'), 'import "./Workspace-W1.js"')
  writeFileSync(join(dist, 'index.html'), '<script type="module" src="./assets/mf-entry-bootstrap-0-abc.js"></script>')
}
afterEach(() => rmSync(dist, { recursive: true, force: true }))

describe('runPostbuild', () => {
  it('writes _headers for the origin and removes the dev page with its own chunks only', () => {
    build()
    const summary = runPostbuild(dist, 'https://shell.example.com')
    expect(readFileSync(join(dist, '_headers'), 'utf8')).toContain('Access-Control-Allow-Origin: https://shell.example.com')
    expect(existsSync(join(dist, 'index.html'))).toBe(false)
    expect(existsSync(join(dist, 'assets/index-D1.js'))).toBe(false)
    expect(existsSync(join(dist, 'assets/mf-entry-bootstrap-0-abc.js'))).toBe(false)
    expect(existsSync(join(dist, 'assets/Workspace-W1.js'))).toBe(true)
    expect(existsSync(join(dist, 'remoteEntry.js'))).toBe(true)
    expect(summary).toBe('dist/_headers allows https://shell.example.com; dist/index.html removed with assets/index-D1.js, assets/mf-entry-bootstrap-0-abc.js')
  })
  it('refuses a missing, wildcard or local origin, and an incomplete build', () => {
    build()
    for (const origin of [undefined, '*', 'http://localhost:4173']) expect(() => runPostbuild(dist, origin)).toThrow(PostbuildError)
    rmSync(join(dist, '404.html'))
    expect(() => runPostbuild(dist, 'https://shell.example.com')).toThrow('dist/404.html is missing')
  })
})
