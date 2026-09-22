# AI Nexus Vercel Production Readiness

Audit date: 2026-09-22

## Status

- Lint: PASS
- TypeScript: PASS
- Tests: PASS (152 tests)
- Build: PASS
- Vercel compatibility: PASS for the Next.js build and Node runtime contract when the required production environment is configured
- Security: hardened for the audited routes; infrastructure-dependent controls remain documented below
- Existing features: preserved

## Required Vercel Configuration

Set these Vercel environment variables for Preview and Production:

- `DATABASE_URL`: PostgreSQL connection string. SQLite is local-development only.
- `AUTH_SECRET`: at least 32 characters of high-entropy secret material.
- `ENCRYPTION_KEY`: exactly 64 hexadecimal characters for AES-256 key material.
- Provider keys only when the corresponding provider is enabled.

The project targets Node 24 through `.nvmrc` and `package.json` engines. The deployment command, which has not been run by this audit, is:

```bash
npx vercel --prod
```

## Fixes Applied

- Removed the empty Next.js experimental configuration block.
- Added an explicit Node compatibility range and Node 24 pin.
- Production configuration now rejects development auth/encryption defaults and SQLite database URLs.
- Prisma CLI configuration fails closed for production SQLite commands.
- PostgreSQL RAG storage now performs portable JSON-embedding persistence and search instead of throwing from a placeholder adapter.
- Document indexing is awaited before the upload response so serverless function shutdown cannot silently abandon it.
- Coding routes now scope workspace reads and task mutations to the authenticated owner.
- Report creation verifies conversation ownership.
- Local filesystem coding workspaces require administrator access.
- Coding subprocesses receive an allowlisted environment rather than the complete application environment.
- Structured logs remove sensitive fields by name before emission.
- Vitest uses an explicit ESM configuration to avoid its native-loader warning.
- The build script regenerates Prisma Client before Next.js runs, preventing stale generated-client failures in clean Vercel builds.

## Unavoidable Infrastructure Requirements

These are not hidden by configuration and require an infrastructure decision before enabling the corresponding production workflows:

- Coding workspaces currently use the function filesystem. Vercel storage is ephemeral and not shared between invocations. Durable coding workspaces require object storage or a persistent worker service.
- Rate limiting is process-local. Multi-instance production deployments require a shared Redis/Upstash or database-backed implementation.
- Browser automation, OCR, command execution, and large document processing are resource-intensive. A worker/container is recommended for workloads that exceed the deployed Vercel function limits.
- PostgreSQL RAG search is correct but scans JSON embeddings in-process. A pgvector migration and indexed vector queries are the performance optimization path for larger corpora.
- No Vercel deployment was performed by this audit.

## Validation

Validated against the current worktree:

```text
Lint: PASS (`npm run lint`)
TypeScript: PASS (`npm run typecheck`)
Tests: PASS (`npm test`, 15 files / 152 tests)
Build: PASS (`npm run build`, including `prisma generate && next build`)
```
