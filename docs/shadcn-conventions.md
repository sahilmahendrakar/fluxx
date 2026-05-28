# shadcn/ui conventions (Fluxx renderer)

## Stack

- **Components:** Copied into `src/components/ui/` via `pnpm dlx shadcn@latest add <name>` (see `components.json`).
- **Style:** `new-york`, **base color:** zinc, **icons:** `lucide-react` (keep Fluxx-specific icons in `src/components/*` where needed).
- **Tokens:** CSS variables in `src/index.css`; Tailwind maps in `tailwind.config.js`.
- **Agent skill:** `.agents/skills/shadcn` — run `pnpm dlx skills add shadcn/ui` after clone if missing.

## Theming

- User preference: `light` | `dark` | `system` in app state (`appearance` field), default **dark**.
- Resolved theme applies `html.dark` or `html.light` and `color-scheme`.
- Use semantic utilities (`bg-background`, `text-muted-foreground`, `border-border`) instead of raw zinc literals for new UI.
- Fluxx workflow colors: `status-needs-input`, `status-validation`, `status-review`, `status-success`, `status-blocked`, `status-terminal`, plus `destructive` for dangerous actions.
- Wrap the renderer in `ThemeProvider` (`src/theme/ThemeProvider.tsx`); read/write appearance with `useAppearance()`.

## Patterns

- Merge classes with `cn()` from `@/lib/utils`.
- Prefer shadcn primitives (`Button`, `Dialog`, `DropdownMenu`, …) over bespoke styled `<button>` elements in migrated surfaces.
- Toasts: `Toaster` from `@/components/ui/sonner` at the app root (uses resolved appearance, not `next-themes` storage).
- Theme QA: load the app with `#/shadcn-smoke` to open `ShadcnThemeSmoke`.

## CLI

```bash
pnpm dlx shadcn@latest add <component> -y
pnpm dlx shadcn@latest info --json
```
