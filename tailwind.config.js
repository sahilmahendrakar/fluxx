/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}', './index.html'],
  theme: {
    extend: {
      colors: {
        /**
         * Semantic Flux surfaces — map to CSS variables in `src/index.css`.
         * Use `bg-flux-canvas`, `text-flux-fg-muted`, `border-flux-border/10`, etc.
         * Prefer these over raw zinc hex when touching UI chrome for theme-aware styling.
         */
        flux: {
          canvas: 'rgb(var(--flux-canvas) / <alpha-value>)',
          sidebar: 'rgb(var(--flux-sidebar) / <alpha-value>)',
          surface: 'rgb(var(--flux-surface) / <alpha-value>)',
          elevated: 'rgb(var(--flux-elevated) / <alpha-value>)',
          border: 'rgb(var(--flux-border) / <alpha-value>)',
          hover: 'rgb(var(--flux-hover) / <alpha-value>)',
          selected: 'rgb(var(--flux-selected) / <alpha-value>)',
          ring: 'rgb(var(--flux-ring) / <alpha-value>)',
          fg: 'rgb(var(--flux-fg) / <alpha-value>)',
          'fg-muted': 'rgb(var(--flux-fg-muted) / <alpha-value>)',
          'fg-subtle': 'rgb(var(--flux-fg-subtle) / <alpha-value>)',
          danger: 'rgb(var(--flux-danger) / <alpha-value>)',
          warning: 'rgb(var(--flux-warning) / <alpha-value>)',
          success: 'rgb(var(--flux-success) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
