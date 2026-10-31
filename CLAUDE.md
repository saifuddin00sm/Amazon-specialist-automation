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
- Phase 1 uses mockDataSource only. Do not add Supabase or Amazon calls until
  asked.
- Anything that changes Amazon or spends money is a Proposal with a status.
  Never mutate live data from a component.
- Show the AIGenerated badge on anything an agent produced.
- Server components by default; client components only for interaction.
- After every change run: pnpm typecheck && pnpm lint && pnpm test

## Domain words

Proposal, Review (rubric scores), ListingVersion, ProductFacts, Guardrail,
AutonomyLevel (L0–L3), AgentRun, AuditEvent
