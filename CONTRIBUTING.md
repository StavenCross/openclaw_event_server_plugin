# Contributing

Thanks for contributing to the OpenClaw Event Server Plugin.

## What to submit

- Bug fixes
- Documentation improvements
- New examples
- Tests that cover bug fixes or new behavior

## Local setup

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Build:
   ```bash
   npm run build
   ```
4. Run tests:
   ```bash
   npm test -- --runInBand
   ```

## Pull request expectations

- Keep PRs focused on one topic.
- Include or update tests when behavior changes.
- Update docs/examples when user-facing behavior changes.
- Ensure CI is green before requesting review.

## Commit guidance

- Use clear, imperative commit messages.
- Examples:
  - `fix: handle tool guard retry backoff edge case`
  - `docs: clarify tool guard approval script flow`

## Reporting bugs

Open an issue and include:

- What you expected
- What actually happened
- Steps to reproduce
- Relevant config snippets (redact secrets)
- Logs or errors
