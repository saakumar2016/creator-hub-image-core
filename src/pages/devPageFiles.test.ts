import { describe, expect, it } from 'vitest'
import { devPageFiles } from './devPageFiles.ts'

// What `vite build` writes for this remote: index.html (the dev page) loads its own bootstrap,
// which imports the dev entry; both also preload chunks that the remote itself needs.
const html = '<script type="module" src="./assets/mf-entry-bootstrap-0-abc.js"></script><link rel="modulepreload" href="./assets/Workspace-W1.js"><link rel="modulepreload" href="./assets/index-D1.js"><link rel="modulepreload" href="./remoteEntry.js">'
const files = {
  'remoteEntry.js': 'import("./assets/Workspace-W1.js"); import "./assets/hostInit-H1.js"',
  'assets/mf-entry-bootstrap-0-abc.js': 'await import("./index-D1.js")',
  'assets/index-D1.js': 'import { a } from "./Workspace-W1.js"',
  'assets/Workspace-W1.js': 'export const a = 1',
  'assets/hostInit-H1.js': '',
}

describe('devPageFiles', () => {
  it('finds the dev page bootstrap and entry, never a chunk of the remote', () => {
    expect(devPageFiles(html, files)).toEqual(['assets/index-D1.js', 'assets/mf-entry-bootstrap-0-abc.js'])
  })
  it('keeps a file that the remote mentions, even if index.html loads it', () => {
    expect(devPageFiles(html, { ...files, 'remoteEntry.js': files['remoteEntry.js'] + ' "./assets/index-D1.js"' })).toEqual(['assets/mf-entry-bootstrap-0-abc.js'])
  })
  it('never the remote entry, which no other file mentions', () => {
    expect(devPageFiles(html, files)).not.toContain('remoteEntry.js')
    expect(devPageFiles(html, { 'remoteEntry.js': '' })).toEqual([])
  })
  it('without a remote entry nothing is removed', () => {
    const { ['remoteEntry.js']: _entry, ...rest } = files
    void _entry
    expect(devPageFiles(html, rest)).toEqual([])
  })
  it('nothing for an index.html that loads nothing of its own', () => {
    expect(devPageFiles('<html></html>', files)).toEqual([])
  })
})
