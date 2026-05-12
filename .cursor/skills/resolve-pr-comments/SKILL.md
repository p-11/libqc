# /resolve-pr-comments - Address PR Review Feedback

1. Fetch unresolved threads via gh api graphql
2. Evaluate each critically (especially CodeRabbit - prefer no-op over churn)
3. Fix valid issues, reply to disagreements, skip noise
4. Run quality checks, commit fixes
5. Resolve threads via GraphQL mutation
6. Push
