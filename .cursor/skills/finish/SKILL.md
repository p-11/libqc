# /finish - PR Lifecycle

1. Verify git identity matches local config
2. Run quality checks (pnpm check)
3. Push branch
4. Create or reuse PR via gh pr create --draft
5. Mark ready + enable auto-merge (gh pr ready, gh pr merge --auto --squash)
6. Poll CI (gh pr checks --watch), fix failures
7. Land on main after merge
