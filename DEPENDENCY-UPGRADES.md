# Upgrading a dependency

All direct dependencies are pinned to exact versions (no `^` or `~` ranges), so builds are reproducible and won't silently pull in newly published code.

## Process

1. **Find the exact version** you want. Check the npm registry or the package's release notes.

2. **Update `package.json`**: edit the version string directly, or run:

   ```bash
   pnpm add <package>@<exact-version> --ignore-scripts
   ```
   `.npmrc` has `save-exact = true`, so `pnpm add` writes a bare version, not a caret range.

3. **Regenerate the lockfile**:

   ```bash
   pnpm install --ignore-scripts
   ```

4. **Verify everything passes**:

   ```bash
   pnpm run check
   ```
   Runs `lint:check`, `prettier:check`, and `test` (which includes a build step).

5. **Commit both files together**: `package.json` and `pnpm-lock.yaml` go in the same PR. Never commit one without the other.

6. **PR description** must say why the version was upgraded (security fix, new feature needed, API change, etc.).
