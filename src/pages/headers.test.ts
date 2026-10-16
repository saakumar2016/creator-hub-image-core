import { describe, expect, it } from 'vitest'
import { checkAllowedOrigin, renderHeaders } from './headers.ts'

describe('checkAllowedOrigin (REMOTE_ALLOWED_ORIGIN)', () => {
  it('accepts a public https origin and normalizes it', () => {
    expect(checkAllowedOrigin('https://my-shell.pages.dev')).toEqual({ origin: 'https://my-shell.pages.dev' })
    expect(checkAllowedOrigin(' https://staging.example.com/ ')).toEqual({ origin: 'https://staging.example.com' })
  })

  it.each([
    [undefined, 'not set'],
    ['', 'not set'],
    ['*', 'not a URL'],
    ['my-shell.pages.dev', 'not a URL'],
    ['http://my-shell.pages.dev', 'https'],
    ['https://user:pw@shell.example.com', 'credentials'],
    ['https://shell.example.com/tools', 'origin only'],
    ['https://shell.example.com/?a=1', 'origin only'],
    ['https://localhost:4173', 'local'],
    ['https://127.0.0.1', 'local'],
    ['https://app.localhost', 'local'],
  ])('rejects %j (%s)', (value, problem) => {
    const result = checkAllowedOrigin(value)
    expect('problem' in result && result.problem).toContain(problem)
  })
})

describe('renderHeaders', () => {
  const text = renderHeaders('https://shell.example.com')

  it('allows exactly the shell origin on the entry and the chunks, and nothing else', () => {
    expect(text.match(/Access-Control-Allow-Origin: https:\/\/shell\.example\.com/g)).toHaveLength(2)
    expect(text).not.toContain('Access-Control-Allow-Origin: *')
    expect(text).not.toMatch(/^\/\*$/m)
  })

  it('revalidates remoteEntry.js and caches hashed chunks for a year', () => {
    expect(text).toMatch(/^\/remoteEntry\.js\n(?: {2}.+\n)*? {2}Cache-Control: no-cache$/m)
    expect(text).toMatch(/^\/assets\/\*\n(?: {2}.+\n)*? {2}Cache-Control: public, max-age=31536000, immutable$/m)
  })

  it('follows the _headers format: path lines at column 0, indented header lines', () => {
    for (const line of text.split('\n').filter(Boolean)) expect(line).toMatch(/^(#|\/| {2}[A-Za-z-]+: \S)/)
  })
})
