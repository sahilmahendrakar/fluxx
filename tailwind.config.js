/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx,html}', './index.html'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        'status-needs-input': {
          DEFAULT: 'hsl(var(--status-needs-input))',
          foreground: 'hsl(var(--status-needs-input-foreground))',
        },
        'status-validation': {
          DEFAULT: 'hsl(var(--status-validation))',
          foreground: 'hsl(var(--status-validation-foreground))',
        },
        'status-review': {
          DEFAULT: 'hsl(var(--status-review))',
          foreground: 'hsl(var(--status-review-foreground))',
        },
        'status-success': {
          DEFAULT: 'hsl(var(--status-success))',
          foreground: 'hsl(var(--status-success-foreground))',
        },
        'status-blocked': {
          DEFAULT: 'hsl(var(--status-blocked))',
          foreground: 'hsl(var(--status-blocked-foreground))',
        },
        'status-terminal': {
          DEFAULT: 'hsl(var(--status-terminal))',
          foreground: 'hsl(var(--status-terminal-foreground))',
        },
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.25)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
