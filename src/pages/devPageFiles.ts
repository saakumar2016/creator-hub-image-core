// The standalone dev page (index.html → src/dev/main.tsx) is built next to the remote by
// `vite build`. pages-postbuild removes index.html; this finds the JavaScript files that only
// the dev page uses, so they are removed too. Conservative: every file whose name appears in
// remoteEntry.js, or in a file the remote reaches that way, is kept.

/** Files (paths relative to dist) that index.html loads and the remote never reaches. */
export function devPageFiles(indexHtml: string, files: Record<string, string>, entry = 'remoteEntry.js'): string[] {
  const names = Object.keys(files)
  const base = (path: string) => path.split('/').pop()!
  const reach = (start: string[], text: (path: string) => string) => {
    const seen = new Set(start)
    const queue = [...start]
    while (queue.length) {
      const content = text(queue.pop()!)
      for (const path of names) {
        if (seen.has(path) || !content.includes(base(path))) continue
        seen.add(path)
        queue.push(path)
      }
    }
    return seen
  }
  if (!(entry in files)) return []
  const remote = reach([entry], (p) => files[p])
  const devReach = reach(names.filter((path) => indexHtml.includes(base(path))), (p) => files[p])
  return [...devReach].filter((p) => !remote.has(p)).sort()
}
