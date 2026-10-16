#!/usr/bin/env node
// `image-core-pages-postbuild`: a tool's build:pages runs it after `vite build`, in the tool's
// folder (dist = ./dist, origin = REMOTE_ALLOWED_ORIGIN). Exit code 1 stops the deployment.
import { resolve } from 'node:path'
import { PostbuildError, runPostbuild } from './postbuild.ts'

try {
  console.log(`pages-postbuild: ${runPostbuild(resolve(process.cwd(), 'dist'), process.env.REMOTE_ALLOWED_ORIGIN)}`)
} catch (error) {
  console.error(`pages-postbuild: ${error instanceof PostbuildError ? error.message : String(error)}`)
  process.exit(1)
}
