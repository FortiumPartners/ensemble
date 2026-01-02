# Tailwind CSS Skill

A comprehensive skill for Tailwind CSS 3.x utility-first styling, responsive design, and custom theme configuration.

## Overview

This skill provides quick reference and in-depth documentation for using Tailwind CSS in modern web projects. It covers utility classes, responsive design patterns, dark mode implementation, and advanced configuration.

## Files

| File | Purpose | Size |
|------|---------|------|
| `SKILL.md` | Quick reference for common patterns and utilities | ~350 lines |
| `REFERENCE.md` | Comprehensive guide with advanced topics | ~600 lines |
| `README.md` | This overview document | - |

## When to Use

This skill auto-loads when:
- Project contains `tailwind.config.js` or `tailwind.config.ts`
- `package.json` includes `tailwindcss` dependency
- User mentions "Tailwind", "utility classes", or "tailwind.config"
- CSS files contain `@tailwind` directives

## Topics Covered

### SKILL.md (Quick Reference)
- Installation and setup
- Core utility classes (spacing, colors, typography, sizing)
- Flexbox and Grid layouts
- Responsive breakpoints (sm, md, lg, xl, 2xl)
- State variants (hover, focus, active, disabled)
- Dark mode configuration
- tailwind.config.js basics
- Common component patterns (buttons, cards, forms, navigation)
- @apply directive usage
- Arbitrary values syntax

### REFERENCE.md (Comprehensive Guide)
- Complete utility class reference by category
- Advanced configuration (presets, safelist, content)
- Custom plugin development
- Animation utilities and keyframes
- Typography plugin (@tailwindcss/typography)
- CSS-in-JS integration (twin.macro, CVA, clsx)
- Framework integration (Next.js, Vite, Nuxt, SvelteKit)
- Performance optimization
- Migration from Tailwind 2.x to 3.x

## Usage Examples

### Basic Styling
```html
<button class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
  Click me
</button>
```

### Responsive Design
```html
<div class="flex flex-col md:flex-row gap-4">
  <div class="w-full md:w-1/3">Sidebar</div>
  <div class="w-full md:w-2/3">Content</div>
</div>
```

### Dark Mode
```html
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
  Adapts to color scheme
</div>
```

## Related Skills

- **React Skill**: Component patterns with Tailwind
- **Next.js Skill**: App Router integration
- **Vue Skill**: SFC styling patterns

## Version

- **Tailwind CSS**: 3.4+
- **Skill Version**: 1.0.0
- **Last Updated**: 2026-01-01
