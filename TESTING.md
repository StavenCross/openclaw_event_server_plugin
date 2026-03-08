# Testing Policy

This root file is the quick entrypoint for running tests.

Detailed test architecture, suite breakdown, and coverage guidance now lives in:

- [docs/testing.md](./docs/testing.md)

## Quick Commands

```bash
nvm use
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm run verify:release
npm run verify:ci
```

Focused suites:

```bash
npm run test:unit
npm run test:integration
```
