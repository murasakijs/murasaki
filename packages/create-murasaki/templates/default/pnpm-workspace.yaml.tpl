# pnpm v10+ does not run a dependency's install/build scripts unless it is
# allow-listed here. Vite needs esbuild's binary, and Biome / @murasakijs/native
# ship native binaries too — without this, `pnpm install` reports
# ERR_PNPM_IGNORED_BUILDS and exits non-zero. `onlyBuiltDependencies` is the
# pnpm-10 key, `allowBuilds` the pnpm-11 one; listing both covers either.
packages:
  - '.'

onlyBuiltDependencies:
  - esbuild
  - '@murasakijs/native'
  - '@biomejs/biome'
allowBuilds:
  esbuild: true
  '@murasakijs/native': true
  '@biomejs/biome': true
