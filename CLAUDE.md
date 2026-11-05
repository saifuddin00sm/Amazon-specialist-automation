# Project: Amazon specialist automation (working name)

## Progress
- Done: steps 1–14 of the build plan (frontend on mock data, Supabase + auth)
- Done: Campaings done list with spend, sales, ACoS and trend
- Done: Campaign creation Wizard. Pick products, a goal (launch, grow, or profit)
- Done: Listings catalog and product page.
- Done: New listing wizard. Product facts, product type search, review; files
  a new_listing Proposal drafted by the listing creator


## Stack
- pnpm + Turborepo monorepo; TypeScript strict everywhere
- apps/web: Next.js App Router, Tailwind, shadcn/ui, lucide-react, Recharts,
  TanStack Table
- Zod schemas in packages/core are the single source of truth for types
- Supabase (Postgres + RLS + auth); Inngest for durable workflows
- Tests: Vitest for units, Playwright for key flows

## Rules
- UI never fetches directly. All reads and writes go through the DataSource
  interface in packages/data.
- DATA_SOURCE=mock|supabase picks the backend (default mock). Both must pass
  the DataSource contract in packages/data.
- Schema changes are a new migration in supabase/migrations with RLS for every
  table, then `pnpm db:types`. Never edit an applied migration.
- Anything that changes Amazon or spends money is a Proposal with a status.
  Never mutate live data from a component.
- Proposal status changes only through the state machine.
- Show the AIGenerated badge on anything an agent produced.
- Server components by default; client components only for interaction.
- After every change run: pnpm typecheck && pnpm lint && pnpm test

## Workflows
- Multi-step or long-running work is an Inngest function with named steps.
- Anything waiting on a human waits for an Inngest event; never poll.

## Amazon
- All Amazon calls live in packages/amazon. UI, workflows and agents call it,
  never Amazon directly.
- Every request sets the user agent
  "<AppName>/<version> (Language=TypeScript) Agent/<AppName>".
- Use the SP-API sandbox unless AMAZON_ENV=production is set.
- Refresh tokens are encrypted at rest. Never log tokens, secrets or seller data.
- Write to Amazon (patch or put) only for a Proposal in Approved status.
- Rate limit with a token bucket per seller + operation; back off on HTTP 429.

## Domain words
Proposal, Review (rubric scores), ListingVersion, ProductFacts, Guardrail,
AutonomyLevel (L0–L3), AgentRun, AuditEvent

## Tooling
- Write Bash commands with literal paths. Don't use shell variables, $(...)
  substitution, or more than one `cd` per command.
- Use the Read/Grep/Glob tools instead of cat/sed/awk/head to read files.

## Git & Branch Strategy
- Never execute `git commit` or `git push` autonomously.
- Always ask the human user to review changes and execute the final version
  control actions.