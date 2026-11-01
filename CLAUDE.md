# Project: Amazon specialist automation (working name)

## Stack

- pnpm + Turborepo monorepo; TypeScript strict everywhere
- apps/web: Next.js App Router, Tailwind, shadcn/ui, lucide-react, Recharts,
  TanStack Table
- Zod schemas in packages/core are the single source of truth for types
- Tests: Vitest for units, Playwright for key flows

## Rules

- UI never fetches directly. All reads and writes go through the DataSource
  interface in packages/data.
- DATA_SOURCE=mock|supabase picks the backend (default mock). Both must pass
  the DataSource contract in packages/data. Do not add Amazon calls until
  asked.
- Schema changes are a new migration in supabase/migrations with RLS for every
  table, then `pnpm db:types`. Never edit an applied migration.
- Anything that changes Amazon or spends money is a Proposal with a status.
  Never mutate live data from a component.
- Show the AIGenerated badge on anything an agent produced.
- Server components by default; client components only for interaction.
- After every change run: pnpm typecheck && pnpm lint && pnpm test

## Domain words

Proposal, Review (rubric scores), ListingVersion, ProductFacts, Guardrail,
AutonomyLevel (L0–L3), AgentRun, AuditEvent

- Write Bash commands with literal paths. Don't use shell variables, $(...) substitution, or more than one `cd` per command.
- Use the Read/Grep/Glob tools instead of cat/sed/awk/head to read files.



## Git & Branch Strategy
- Never execute `git commit` or `git push` autonomously.
- Always ask the human user to review changes and execute the final version control actions.
