# Frontend — (React 19 + Vite)

## ⚠️ Before writing any code in `front/src`, load the `frontend-conventions` skill

The conventions are **non-negotiable** and live in that skill's `references/`
([`.claude/skills/frontend-conventions/`](../.claude/skills/frontend-conventions/SKILL.md)) —
eight topic docs covering code style, folder structure and route registration, the `hooks.jsx`
contract, the API service layers, auth/permissions, the design system, and the form pattern. The
skill's table says which one to read for the area you're touching. Read it **before** writing, not
after.

Building a whole new CRUD module? Use the **`new-module`** skill instead — it drives this one plus
the backend half in the right order.

## Stack

React 19 (function components, hooks only) · JavaScript (no TypeScript) · Vite ·
**shadcn/ui** (Radix primitives + Tailwind, in `src/components/ui/`) · Tailwind CSS v4 · Zustand ·
TanStack React Query · **react-hook-form + zod** (forms) · **sonner** (toasts) ·
**@tanstack/react-table** (tables, via the shared `DataTable`) · axios · react-router v8 ·
lucide-react · dayjs. Type is **Onest** (UI) + **JetBrains Mono** (micro-data only) + **Space Grotesk** (the wordmark), self-hosted
via `@fontsource-variable`.

> All UI primitives are **shadcn/ui** — import them from `@/components/ui/*` (the `@/` alias →
> `src/`) and use lucide-react for icons. Don't introduce another component or icon library.

## Design system — "Modern"

Cool-white surfaces + hairline borders in the **DGSports brand** (CR-036, the DGPlay logo's blue
`#174F8A`→`#4189C8` and its ball's lime `#E2F41F`): dark ink text, a light sidebar and top bar (the
DGPlay logo, lime bar on the current page), **blue primary buttons with white text** (lime with
dark text in dark), brighter-blue links and charts, the lime accent for bars, ticks and focus
rings. The logo and every icon come from `node scripts/brand-icons.mjs`
(`scripts/brand/dgplay.mjs`); the web splash is `index.html`'s `#dg-splash` + `components/splash/`. Structure comes from borders, **not shadows**; the primary button is
the shadcn `<Button>` default variant, which the token bridge maps to blue/white (lime/dark in dark) (never a gradient,
never an inline background). Every color is a token in `src/index.css` — **never hardcode a
hex**.

shadcn's semantic tokens (`--background`, `--card`, `--primary`, `--border`, `--ring`, …) are
bridged onto the Modern tokens in `src/index.css` (the `@theme inline` block), so shadcn
components inherit this design in light and dark with no per-component theming.

- **`modern-module-pattern.md`** (in the skill) — the canonical, copy-paste spec for a module's
  list page + create/edit drawer. Read it before building either.
- **`src/pages/Admin/UserManagement/Roles/`** — the reference implementation. Copy its shape.
- Shared building blocks: `components/PageHeader.jsx`, `StatCard.jsx`, `DataTable.jsx`,
  `SearchInput.jsx`, `RowActions.jsx`, `PaginationFooter.jsx`, `SectionLabel.jsx`,
  `StatusToggle.jsx`, `PasswordInput.jsx`, `DescriptionList.jsx`, `Spinner.jsx`, `ResultState.jsx`.
