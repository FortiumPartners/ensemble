# Tailwind CSS 3.x Reference Guide

**Version**: 1.0.0 | **Purpose**: Comprehensive reference for advanced Tailwind CSS patterns

---

## Table of Contents

1. [Complete Utility Reference](#complete-utility-reference)
2. [Advanced Configuration](#advanced-configuration)
3. [Custom Plugin Development](#custom-plugin-development)
4. [Animation Utilities](#animation-utilities)
5. [Typography Plugin](#typography-plugin)
6. [CSS-in-JS Integration](#css-in-js-integration)
7. [Framework Integration](#framework-integration)
8. [Performance Optimization](#performance-optimization)
9. [Migration Guide](#migration-guide)

---

## Complete Utility Reference

### Layout

| Category | Classes |
|----------|---------|
| Container | `container` |
| Box Sizing | `box-border`, `box-content` |
| Display | `block`, `inline-block`, `inline`, `flex`, `inline-flex`, `grid`, `inline-grid`, `hidden`, `contents`, `flow-root`, `list-item` |
| Float | `float-left`, `float-right`, `float-none`, `float-start`, `float-end` |
| Clear | `clear-left`, `clear-right`, `clear-both`, `clear-none`, `clear-start`, `clear-end` |
| Isolation | `isolate`, `isolation-auto` |
| Object Fit | `object-contain`, `object-cover`, `object-fill`, `object-none`, `object-scale-down` |
| Object Position | `object-{position}` (bottom, center, left, right, top, etc.) |
| Overflow | `overflow-auto`, `overflow-hidden`, `overflow-clip`, `overflow-visible`, `overflow-scroll`, `overflow-x-*`, `overflow-y-*` |
| Overscroll | `overscroll-auto`, `overscroll-contain`, `overscroll-none` |
| Position | `static`, `fixed`, `absolute`, `relative`, `sticky` |
| Inset | `inset-{size}`, `inset-x-{size}`, `inset-y-{size}`, `top-{size}`, `right-{size}`, `bottom-{size}`, `left-{size}`, `start-{size}`, `end-{size}` |
| Visibility | `visible`, `invisible`, `collapse` |
| Z-Index | `z-0`, `z-10`, `z-20`, `z-30`, `z-40`, `z-50`, `z-auto` |

### Flexbox & Grid

| Category | Classes |
|----------|---------|
| Flex Direction | `flex-row`, `flex-row-reverse`, `flex-col`, `flex-col-reverse` |
| Flex Wrap | `flex-wrap`, `flex-wrap-reverse`, `flex-nowrap` |
| Flex | `flex-1`, `flex-auto`, `flex-initial`, `flex-none` |
| Flex Grow | `grow`, `grow-0` |
| Flex Shrink | `shrink`, `shrink-0` |
| Order | `order-{1-12}`, `order-first`, `order-last`, `order-none` |
| Grid Template Columns | `grid-cols-{1-12}`, `grid-cols-none`, `grid-cols-subgrid` |
| Grid Column Span | `col-auto`, `col-span-{1-12}`, `col-span-full`, `col-start-{1-13}`, `col-end-{1-13}` |
| Grid Template Rows | `grid-rows-{1-12}`, `grid-rows-none`, `grid-rows-subgrid` |
| Grid Row Span | `row-auto`, `row-span-{1-12}`, `row-span-full`, `row-start-{1-13}`, `row-end-{1-13}` |
| Grid Auto Flow | `grid-flow-row`, `grid-flow-col`, `grid-flow-dense`, `grid-flow-row-dense`, `grid-flow-col-dense` |
| Grid Auto Columns | `auto-cols-auto`, `auto-cols-min`, `auto-cols-max`, `auto-cols-fr` |
| Grid Auto Rows | `auto-rows-auto`, `auto-rows-min`, `auto-rows-max`, `auto-rows-fr` |
| Gap | `gap-{size}`, `gap-x-{size}`, `gap-y-{size}` |
| Justify Content | `justify-normal`, `justify-start`, `justify-end`, `justify-center`, `justify-between`, `justify-around`, `justify-evenly`, `justify-stretch` |
| Justify Items | `justify-items-start`, `justify-items-end`, `justify-items-center`, `justify-items-stretch` |
| Justify Self | `justify-self-auto`, `justify-self-start`, `justify-self-end`, `justify-self-center`, `justify-self-stretch` |
| Align Content | `content-normal`, `content-center`, `content-start`, `content-end`, `content-between`, `content-around`, `content-evenly`, `content-baseline`, `content-stretch` |
| Align Items | `items-start`, `items-end`, `items-center`, `items-baseline`, `items-stretch` |
| Align Self | `self-auto`, `self-start`, `self-end`, `self-center`, `self-stretch`, `self-baseline` |
| Place Content | `place-content-{value}` |
| Place Items | `place-items-{value}` |
| Place Self | `place-self-{value}` |

### Spacing

| Category | Classes |
|----------|---------|
| Padding | `p-{size}`, `px-{size}`, `py-{size}`, `ps-{size}`, `pe-{size}`, `pt-{size}`, `pr-{size}`, `pb-{size}`, `pl-{size}` |
| Margin | `m-{size}`, `mx-{size}`, `my-{size}`, `ms-{size}`, `me-{size}`, `mt-{size}`, `mr-{size}`, `mb-{size}`, `ml-{size}` |
| Space Between | `space-x-{size}`, `space-y-{size}`, `space-x-reverse`, `space-y-reverse` |

### Sizing

| Category | Classes |
|----------|---------|
| Width | `w-{size}`, `w-{fraction}`, `w-auto`, `w-full`, `w-screen`, `w-svw`, `w-lvw`, `w-dvw`, `w-min`, `w-max`, `w-fit` |
| Min-Width | `min-w-{size}`, `min-w-full`, `min-w-min`, `min-w-max`, `min-w-fit` |
| Max-Width | `max-w-{size}`, `max-w-none`, `max-w-xs` through `max-w-7xl`, `max-w-full`, `max-w-min`, `max-w-max`, `max-w-fit`, `max-w-prose`, `max-w-screen-sm` through `max-w-screen-2xl` |
| Height | `h-{size}`, `h-{fraction}`, `h-auto`, `h-full`, `h-screen`, `h-svh`, `h-lvh`, `h-dvh`, `h-min`, `h-max`, `h-fit` |
| Min-Height | `min-h-{size}`, `min-h-full`, `min-h-screen`, `min-h-svh`, `min-h-lvh`, `min-h-dvh`, `min-h-min`, `min-h-max`, `min-h-fit` |
| Max-Height | `max-h-{size}`, `max-h-none`, `max-h-full`, `max-h-screen`, `max-h-svh`, `max-h-lvh`, `max-h-dvh`, `max-h-min`, `max-h-max`, `max-h-fit` |
| Size | `size-{size}`, `size-auto`, `size-full`, `size-min`, `size-max`, `size-fit` |

### Typography

| Category | Classes |
|----------|---------|
| Font Family | `font-sans`, `font-serif`, `font-mono` |
| Font Size | `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`, `text-5xl`, `text-6xl`, `text-7xl`, `text-8xl`, `text-9xl` |
| Font Smoothing | `antialiased`, `subpixel-antialiased` |
| Font Style | `italic`, `not-italic` |
| Font Weight | `font-thin`, `font-extralight`, `font-light`, `font-normal`, `font-medium`, `font-semibold`, `font-bold`, `font-extrabold`, `font-black` |
| Font Variant Numeric | `normal-nums`, `ordinal`, `slashed-zero`, `lining-nums`, `oldstyle-nums`, `proportional-nums`, `tabular-nums`, `diagonal-fractions`, `stacked-fractions` |
| Letter Spacing | `tracking-tighter`, `tracking-tight`, `tracking-normal`, `tracking-wide`, `tracking-wider`, `tracking-widest` |
| Line Clamp | `line-clamp-{1-6}`, `line-clamp-none` |
| Line Height | `leading-{3-10}`, `leading-none`, `leading-tight`, `leading-snug`, `leading-normal`, `leading-relaxed`, `leading-loose` |
| List Style Image | `list-image-none` |
| List Style Position | `list-inside`, `list-outside` |
| List Style Type | `list-none`, `list-disc`, `list-decimal` |
| Text Align | `text-left`, `text-center`, `text-right`, `text-justify`, `text-start`, `text-end` |
| Text Color | `text-{color}-{shade}` |
| Text Decoration | `underline`, `overline`, `line-through`, `no-underline` |
| Text Decoration Color | `decoration-{color}-{shade}` |
| Text Decoration Style | `decoration-solid`, `decoration-double`, `decoration-dotted`, `decoration-dashed`, `decoration-wavy` |
| Text Decoration Thickness | `decoration-auto`, `decoration-from-font`, `decoration-0`, `decoration-1`, `decoration-2`, `decoration-4`, `decoration-8` |
| Text Underline Offset | `underline-offset-auto`, `underline-offset-{0-8}` |
| Text Transform | `uppercase`, `lowercase`, `capitalize`, `normal-case` |
| Text Overflow | `truncate`, `text-ellipsis`, `text-clip` |
| Text Wrap | `text-wrap`, `text-nowrap`, `text-balance`, `text-pretty` |
| Text Indent | `indent-{size}` |
| Vertical Align | `align-baseline`, `align-top`, `align-middle`, `align-bottom`, `align-text-top`, `align-text-bottom`, `align-sub`, `align-super` |
| Whitespace | `whitespace-normal`, `whitespace-nowrap`, `whitespace-pre`, `whitespace-pre-line`, `whitespace-pre-wrap`, `whitespace-break-spaces` |
| Word Break | `break-normal`, `break-words`, `break-all`, `break-keep` |
| Hyphens | `hyphens-none`, `hyphens-manual`, `hyphens-auto` |
| Content | `content-none` |

### Backgrounds

| Category | Classes |
|----------|---------|
| Background Attachment | `bg-fixed`, `bg-local`, `bg-scroll` |
| Background Clip | `bg-clip-border`, `bg-clip-padding`, `bg-clip-content`, `bg-clip-text` |
| Background Color | `bg-{color}-{shade}` |
| Background Origin | `bg-origin-border`, `bg-origin-padding`, `bg-origin-content` |
| Background Position | `bg-bottom`, `bg-center`, `bg-left`, `bg-left-bottom`, `bg-left-top`, `bg-right`, `bg-right-bottom`, `bg-right-top`, `bg-top` |
| Background Repeat | `bg-repeat`, `bg-no-repeat`, `bg-repeat-x`, `bg-repeat-y`, `bg-repeat-round`, `bg-repeat-space` |
| Background Size | `bg-auto`, `bg-cover`, `bg-contain` |
| Background Image | `bg-none`, `bg-gradient-to-{direction}` |
| Gradient Color Stops | `from-{color}`, `via-{color}`, `to-{color}`, `from-{percent}`, `via-{percent}`, `to-{percent}` |

### Borders

| Category | Classes |
|----------|---------|
| Border Radius | `rounded-none`, `rounded-sm`, `rounded`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-full`, `rounded-{t/r/b/l/tl/tr/br/bl}-*` |
| Border Width | `border`, `border-0`, `border-2`, `border-4`, `border-8`, `border-{x/y/t/r/b/l/s/e}-*` |
| Border Color | `border-{color}-{shade}` |
| Border Style | `border-solid`, `border-dashed`, `border-dotted`, `border-double`, `border-hidden`, `border-none` |
| Divide Width | `divide-x-{size}`, `divide-y-{size}`, `divide-x-reverse`, `divide-y-reverse` |
| Divide Color | `divide-{color}-{shade}` |
| Divide Style | `divide-solid`, `divide-dashed`, `divide-dotted`, `divide-double`, `divide-none` |
| Outline Width | `outline-0`, `outline-1`, `outline-2`, `outline-4`, `outline-8` |
| Outline Color | `outline-{color}-{shade}` |
| Outline Style | `outline-none`, `outline`, `outline-dashed`, `outline-dotted`, `outline-double` |
| Outline Offset | `outline-offset-{0-8}` |
| Ring Width | `ring`, `ring-0`, `ring-1`, `ring-2`, `ring-4`, `ring-8`, `ring-inset` |
| Ring Color | `ring-{color}-{shade}` |
| Ring Offset Width | `ring-offset-{0-8}` |
| Ring Offset Color | `ring-offset-{color}-{shade}` |

### Effects

| Category | Classes |
|----------|---------|
| Box Shadow | `shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-inner`, `shadow-none` |
| Box Shadow Color | `shadow-{color}-{shade}` |
| Opacity | `opacity-{0-100}` (0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 95, 100) |
| Mix Blend Mode | `mix-blend-{mode}` (normal, multiply, screen, overlay, darken, lighten, etc.) |
| Background Blend Mode | `bg-blend-{mode}` |

### Filters

| Category | Classes |
|----------|---------|
| Blur | `blur-none`, `blur-sm`, `blur`, `blur-md`, `blur-lg`, `blur-xl`, `blur-2xl`, `blur-3xl` |
| Brightness | `brightness-{0-200}` (0, 50, 75, 90, 95, 100, 105, 110, 125, 150, 200) |
| Contrast | `contrast-{0-200}` |
| Drop Shadow | `drop-shadow-sm`, `drop-shadow`, `drop-shadow-md`, `drop-shadow-lg`, `drop-shadow-xl`, `drop-shadow-2xl`, `drop-shadow-none` |
| Grayscale | `grayscale-0`, `grayscale` |
| Hue Rotate | `hue-rotate-{0-180}` (0, 15, 30, 60, 90, 180) |
| Invert | `invert-0`, `invert` |
| Saturate | `saturate-{0-200}` (0, 50, 100, 150, 200) |
| Sepia | `sepia-0`, `sepia` |
| Backdrop Blur | `backdrop-blur-*` |
| Backdrop Brightness | `backdrop-brightness-*` |
| Backdrop Contrast | `backdrop-contrast-*` |
| Backdrop Grayscale | `backdrop-grayscale-*` |
| Backdrop Hue Rotate | `backdrop-hue-rotate-*` |
| Backdrop Invert | `backdrop-invert-*` |
| Backdrop Opacity | `backdrop-opacity-*` |
| Backdrop Saturate | `backdrop-saturate-*` |
| Backdrop Sepia | `backdrop-sepia-*` |

### Tables

| Category | Classes |
|----------|---------|
| Border Collapse | `border-collapse`, `border-separate` |
| Border Spacing | `border-spacing-{size}`, `border-spacing-x-{size}`, `border-spacing-y-{size}` |
| Table Layout | `table-auto`, `table-fixed` |
| Caption Side | `caption-top`, `caption-bottom` |

### Transitions & Animation

| Category | Classes |
|----------|---------|
| Transition Property | `transition-none`, `transition-all`, `transition`, `transition-colors`, `transition-opacity`, `transition-shadow`, `transition-transform` |
| Transition Duration | `duration-{0-1000}` (0, 75, 100, 150, 200, 300, 500, 700, 1000) |
| Transition Timing Function | `ease-linear`, `ease-in`, `ease-out`, `ease-in-out` |
| Transition Delay | `delay-{0-1000}` |
| Animation | `animate-none`, `animate-spin`, `animate-ping`, `animate-pulse`, `animate-bounce` |

### Transforms

| Category | Classes |
|----------|---------|
| Scale | `scale-{0-150}` (0, 50, 75, 90, 95, 100, 105, 110, 125, 150), `scale-x-*`, `scale-y-*` |
| Rotate | `rotate-{0-180}` (0, 1, 2, 3, 6, 12, 45, 90, 180), `-rotate-*` |
| Translate | `translate-x-{size}`, `translate-y-{size}`, `-translate-*` |
| Skew | `skew-x-{0-12}`, `skew-y-{0-12}`, `-skew-*` |
| Transform Origin | `origin-center`, `origin-top`, `origin-top-right`, `origin-right`, `origin-bottom-right`, `origin-bottom`, `origin-bottom-left`, `origin-left`, `origin-top-left` |

### Interactivity

| Category | Classes |
|----------|---------|
| Accent Color | `accent-{color}-{shade}`, `accent-auto` |
| Appearance | `appearance-none`, `appearance-auto` |
| Cursor | `cursor-auto`, `cursor-default`, `cursor-pointer`, `cursor-wait`, `cursor-text`, `cursor-move`, `cursor-help`, `cursor-not-allowed`, `cursor-none`, `cursor-context-menu`, `cursor-progress`, `cursor-cell`, `cursor-crosshair`, `cursor-vertical-text`, `cursor-alias`, `cursor-copy`, `cursor-no-drop`, `cursor-grab`, `cursor-grabbing`, `cursor-all-scroll`, `cursor-col-resize`, `cursor-row-resize`, `cursor-n-resize`, `cursor-e-resize`, `cursor-s-resize`, `cursor-w-resize`, `cursor-ne-resize`, `cursor-nw-resize`, `cursor-se-resize`, `cursor-sw-resize`, `cursor-ew-resize`, `cursor-ns-resize`, `cursor-nesw-resize`, `cursor-nwse-resize`, `cursor-zoom-in`, `cursor-zoom-out` |
| Caret Color | `caret-{color}-{shade}` |
| Pointer Events | `pointer-events-none`, `pointer-events-auto` |
| Resize | `resize-none`, `resize-y`, `resize-x`, `resize` |
| Scroll Behavior | `scroll-auto`, `scroll-smooth` |
| Scroll Margin | `scroll-m-{size}`, `scroll-mx-{size}`, `scroll-my-{size}`, etc. |
| Scroll Padding | `scroll-p-{size}`, `scroll-px-{size}`, `scroll-py-{size}`, etc. |
| Scroll Snap Align | `snap-start`, `snap-end`, `snap-center`, `snap-align-none` |
| Scroll Snap Stop | `snap-normal`, `snap-always` |
| Scroll Snap Type | `snap-none`, `snap-x`, `snap-y`, `snap-both`, `snap-mandatory`, `snap-proximity` |
| Touch Action | `touch-auto`, `touch-none`, `touch-pan-x`, `touch-pan-left`, `touch-pan-right`, `touch-pan-y`, `touch-pan-up`, `touch-pan-down`, `touch-pinch-zoom`, `touch-manipulation` |
| User Select | `select-none`, `select-text`, `select-all`, `select-auto` |
| Will Change | `will-change-auto`, `will-change-scroll`, `will-change-contents`, `will-change-transform` |

### SVG

| Category | Classes |
|----------|---------|
| Fill | `fill-{color}-{shade}`, `fill-none` |
| Stroke | `stroke-{color}-{shade}`, `stroke-none` |
| Stroke Width | `stroke-{0-2}` |

### Accessibility

| Category | Classes |
|----------|---------|
| Screen Readers | `sr-only`, `not-sr-only` |
| Forced Color Adjust | `forced-color-adjust-auto`, `forced-color-adjust-none` |

---

## Advanced Configuration

### Full Theme Override vs Extend

```javascript
// Override entire color palette (replaces defaults)
module.exports = {
  theme: {
    colors: {
      // Only these colors will be available
      primary: '#3490dc',
      secondary: '#ffed4a',
      danger: '#e3342f',
    }
  }
}

// Extend defaults (keeps all defaults + adds new)
module.exports = {
  theme: {
    extend: {
      colors: {
        // These are added to default colors
        primary: '#3490dc',
      }
    }
  }
}
```

### Content Configuration Patterns

```javascript
module.exports = {
  content: {
    files: [
      './src/**/*.{js,jsx,ts,tsx,vue,svelte}',
      './index.html',
      './public/**/*.html',
    ],
    // Transform content before scanning
    transform: {
      md: (content) => {
        return content.replace(/class="([^"]*)"/g, (match, p1) => p1);
      }
    },
    // Extract class names from custom syntax
    extract: {
      md: (content) => {
        return content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || [];
      }
    }
  },
}
```

### Safelist Patterns

```javascript
module.exports = {
  safelist: [
    // Simple strings
    'bg-red-500',
    'text-3xl',

    // Patterns with regex
    {
      pattern: /bg-(red|green|blue)-(100|200|300)/,
    },

    // Patterns with variants
    {
      pattern: /bg-(red|green|blue)-(100|200|300)/,
      variants: ['hover', 'focus', 'lg'],
    },
  ],
}
```

### Presets

```javascript
// my-preset.js
module.exports = {
  theme: {
    colors: {
      brand: {
        light: '#3fbaeb',
        DEFAULT: '#0fa9e6',
        dark: '#0c87b8',
      }
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}

// tailwind.config.js
module.exports = {
  presets: [
    require('./my-preset.js'),
  ],
  // Your project-specific config
  theme: {
    extend: {
      // This extends the preset
    }
  }
}
```

### Important Selector Strategy

```javascript
module.exports = {
  // Prefix all utilities with !important
  important: true,

  // Or use a selector strategy
  important: '#app',

  // Or use class strategy
  important: '.tailwind',
}
```

### Prefix Configuration

```javascript
module.exports = {
  prefix: 'tw-',
  // Usage: tw-bg-blue-500 tw-text-white
}
```

---

## Custom Plugin Development

### Basic Plugin Structure

```javascript
const plugin = require('tailwindcss/plugin');

module.exports = plugin(function({ addUtilities, addComponents, addBase, theme, matchUtilities }) {
  // Add custom utilities
  addUtilities({
    '.content-auto': {
      'content-visibility': 'auto',
    },
    '.content-hidden': {
      'content-visibility': 'hidden',
    },
  });

  // Add custom components
  addComponents({
    '.btn': {
      padding: theme('spacing.4'),
      borderRadius: theme('borderRadius.lg'),
      fontWeight: theme('fontWeight.semibold'),
    },
    '.btn-primary': {
      backgroundColor: theme('colors.blue.500'),
      color: theme('colors.white'),
      '&:hover': {
        backgroundColor: theme('colors.blue.600'),
      },
    },
  });

  // Add base styles
  addBase({
    'h1': {
      fontSize: theme('fontSize.2xl'),
      fontWeight: theme('fontWeight.bold'),
    },
    'h2': {
      fontSize: theme('fontSize.xl'),
      fontWeight: theme('fontWeight.semibold'),
    },
  });
});
```

### Dynamic Utilities with matchUtilities

```javascript
const plugin = require('tailwindcss/plugin');

module.exports = plugin(function({ matchUtilities, theme }) {
  // Creates text-shadow-sm, text-shadow-md, etc.
  matchUtilities(
    {
      'text-shadow': (value) => ({
        textShadow: value,
      }),
    },
    {
      values: theme('textShadow'),
    }
  );
}, {
  // Plugin configuration
  theme: {
    textShadow: {
      sm: '0 1px 2px var(--tw-shadow-color)',
      DEFAULT: '0 2px 4px var(--tw-shadow-color)',
      lg: '0 8px 16px var(--tw-shadow-color)',
    },
  },
});
```

### Plugin with Options

```javascript
const plugin = require('tailwindcss/plugin');

module.exports = plugin.withOptions(
  function(options = {}) {
    return function({ addComponents, theme }) {
      const { prefix = 'custom' } = options;

      addComponents({
        [`.${prefix}-card`]: {
          backgroundColor: theme('colors.white'),
          borderRadius: theme('borderRadius.lg'),
          padding: theme('spacing.6'),
          boxShadow: theme('boxShadow.xl'),
        },
      });
    };
  },
  function(options = {}) {
    return {
      theme: {
        extend: {
          // Extend theme here
        },
      },
    };
  }
);

// Usage in config:
// plugins: [require('./my-plugin')({ prefix: 'my' })]
```

### Adding Variants

```javascript
const plugin = require('tailwindcss/plugin');

module.exports = plugin(function({ addVariant }) {
  // Add custom variant
  addVariant('hocus', ['&:hover', '&:focus']);
  addVariant('supports-grid', '@supports (display: grid)');
  addVariant('optional', '&:optional');
  addVariant('inverted-colors', '@media (inverted-colors: inverted)');

  // Parent-based variant
  addVariant('group-active', ':merge(.group):active &');

  // Complex variant
  addVariant('not-last', '&:not(:last-child)');
});

// Usage: hocus:bg-blue-500 supports-grid:grid
```

---

## Animation Utilities

### Built-in Animations

```html
<!-- Spin (360deg rotation) -->
<svg class="animate-spin h-5 w-5 text-blue-500">...</svg>

<!-- Ping (radar pulse) -->
<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>

<!-- Pulse (opacity fade) -->
<div class="animate-pulse bg-gray-200 h-12 rounded"></div>

<!-- Bounce -->
<div class="animate-bounce">Jump!</div>
```

### Custom Animations

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'fade-out': 'fadeOut 0.5s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'slide-out': 'slideOut 0.3s ease-in',
        'scale-up': 'scaleUp 0.2s ease-out',
        'wiggle': 'wiggle 1s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        slideOut: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' },
        },
        scaleUp: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
}
```

### Animation Utilities Pattern

```html
<!-- Combine animation with transition -->
<div class="animate-fade-in transition-all duration-300 hover:scale-105">
  Animated card
</div>

<!-- Motion-safe animations -->
<div class="motion-safe:animate-bounce motion-reduce:animate-none">
  Respects reduced motion
</div>

<!-- Delayed animation -->
<div class="animate-fade-in [animation-delay:200ms]">
  Delayed by 200ms
</div>
```

---

## Typography Plugin

### Installation

```bash
npm install -D @tailwindcss/typography
```

### Configuration

```javascript
// tailwind.config.js
module.exports = {
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
```

### Usage

```html
<article class="prose lg:prose-xl dark:prose-invert">
  <h1>Article Title</h1>
  <p>Your content here...</p>
</article>
```

### Size Modifiers

| Class | Description |
|-------|-------------|
| `prose-sm` | Smaller typography |
| `prose` | Default size |
| `prose-lg` | Larger typography |
| `prose-xl` | Extra large |
| `prose-2xl` | Double extra large |

### Color Themes

| Class | Description |
|-------|-------------|
| `prose-gray` | Gray color scheme (default) |
| `prose-slate` | Slate colors |
| `prose-zinc` | Zinc colors |
| `prose-neutral` | Neutral colors |
| `prose-stone` | Stone colors |
| `prose-invert` | Inverted for dark backgrounds |

### Customizing Typography

```javascript
module.exports = {
  theme: {
    extend: {
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme('colors.gray.700'),
            a: {
              color: theme('colors.blue.500'),
              '&:hover': {
                color: theme('colors.blue.700'),
              },
            },
            'h1, h2, h3': {
              fontWeight: theme('fontWeight.bold'),
            },
            code: {
              backgroundColor: theme('colors.gray.100'),
              padding: theme('spacing.1'),
              borderRadius: theme('borderRadius.sm'),
            },
          },
        },
        // Dark mode
        invert: {
          css: {
            color: theme('colors.gray.300'),
          },
        },
      }),
    },
  },
}
```

### Undoing Typography Styles

```html
<article class="prose">
  <h1>Styled heading</h1>
  <p>Styled paragraph</p>
  <div class="not-prose">
    <!-- This content is NOT styled by prose -->
    <CustomComponent />
  </div>
</article>
```

---

## CSS-in-JS Integration

### twin.macro (Styled Components / Emotion)

```bash
npm install twin.macro @emotion/react @emotion/styled
```

**babel-plugin-macros.config.js**:
```javascript
module.exports = {
  twin: {
    preset: 'styled-components', // or 'emotion'
    config: './tailwind.config.js',
    includeClassNames: true,
  },
}
```

**Usage**:
```jsx
import tw, { styled, css } from 'twin.macro';

// tw prop
const Button = () => (
  <button tw="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
    Click me
  </button>
);

// styled helper
const StyledButton = styled.button`
  ${tw`px-4 py-2 bg-blue-500 text-white rounded`}

  &:hover {
    ${tw`bg-blue-600`}
  }
`;

// css helper
const customStyles = css`
  ${tw`p-4 rounded-lg`}
  background: linear-gradient(to right, #3490dc, #6574cd);
`;

// Conditional classes
const Alert = ({ variant }) => (
  <div
    tw="p-4 rounded-lg"
    css={[
      variant === 'error' && tw`bg-red-100 text-red-900`,
      variant === 'success' && tw`bg-green-100 text-green-900`,
    ]}
  >
    Alert content
  </div>
);
```

### CVA (Class Variance Authority)

```bash
npm install class-variance-authority
```

**Usage**:
```typescript
import { cva, type VariantProps } from 'class-variance-authority';

const button = cva(
  // Base styles
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        primary: 'bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-500',
        secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500',
        danger: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
        ghost: 'hover:bg-gray-100 focus:ring-gray-500',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

// Type-safe props
type ButtonProps = VariantProps<typeof button>;

// Usage
<button className={button({ variant: 'primary', size: 'lg' })}>
  Click me
</button>
```

### clsx + tailwind-merge

```bash
npm install clsx tailwind-merge
```

**Utility function**:
```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Usage
<div className={cn(
  'p-4 rounded-lg',
  isActive && 'bg-blue-500',
  isDisabled && 'opacity-50 cursor-not-allowed',
  className  // Allow overrides
)}>
```

---

## Framework Integration

### Next.js (App Router)

**tailwind.config.ts**:
```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

**app/globals.css**:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Vite (React/Vue)

**vite.config.ts**:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
});
```

### Nuxt 3

**nuxt.config.ts**:
```typescript
export default defineNuxtConfig({
  modules: ['@nuxtjs/tailwindcss'],
  tailwindcss: {
    configPath: 'tailwind.config.ts',
    exposeConfig: true,
  },
});
```

### SvelteKit

**svelte.config.js**:
```javascript
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
};
```

---

## Performance Optimization

### Content Configuration Best Practices

```javascript
module.exports = {
  content: [
    // DO: Be specific
    './src/components/**/*.{js,jsx,ts,tsx}',
    './src/pages/**/*.{js,jsx,ts,tsx}',

    // DON'T: Scan node_modules
    // './node_modules/**/*.js',  // Never do this

    // DO: Include only needed external packages
    './node_modules/@my-ui-lib/src/**/*.js',
  ],
}
```

### Reducing Bundle Size

1. **Use Specific Imports**:
```javascript
// Instead of importing all plugins
plugins: [
  require('@tailwindcss/typography'),
  require('@tailwindcss/forms'),
]

// Only import what you use
plugins: [
  require('@tailwindcss/typography'),
]
```

2. **Disable Unused Core Plugins**:
```javascript
module.exports = {
  corePlugins: {
    // Disable if not using
    float: false,
    clear: false,
    objectFit: false,
    objectPosition: false,
  },
}
```

3. **Use PurgeCSS in Production** (automatic with content config):
```javascript
// Already handled by Tailwind's content configuration
// No additional setup needed for Tailwind 3.x
```

### JIT Optimizations

JIT (Just-in-Time) is enabled by default in Tailwind 3.x:

- Generates only used styles
- Supports arbitrary values
- Faster build times
- No need for safelist for dynamic classes (if using full class names)

### Monitoring Bundle Size

```bash
# Analyze CSS output
npx tailwindcss -i input.css -o output.css --minify
du -h output.css

# Expected sizes:
# - Development: 3-4MB (all utilities)
# - Production: 10-50KB (typical app)
```

---

## Migration Guide

### From Tailwind 2.x to 3.x

**Breaking Changes**:

1. **JIT is default**: No `mode: 'jit'` needed
2. **Purge → Content**:
```javascript
// Old (v2)
module.exports = {
  purge: ['./src/**/*.js'],
}

// New (v3)
module.exports = {
  content: ['./src/**/*.js'],
}
```

3. **Color palette changes**:
```javascript
// Old names → New names
// blueGray → slate
// warmGray → stone
// trueGray → neutral
// coolGray → gray
// lightBlue → sky
```

4. **Overflow utilities**:
```html
<!-- Old -->
<div class="overflow-ellipsis"></div>

<!-- New -->
<div class="text-ellipsis"></div>
```

5. **Flex grow/shrink**:
```html
<!-- Old -->
<div class="flex-grow-0 flex-shrink"></div>

<!-- New -->
<div class="grow-0 shrink"></div>
```

6. **Outline ring**:
```html
<!-- Old -->
<button class="outline-none focus:outline-none"></button>

<!-- New (use ring utilities) -->
<button class="focus:ring-2 focus:ring-blue-500"></button>
```

### Upgrade Command

```bash
npx @tailwindcss/upgrade
```

---

## Quick Reference

### Arbitrary Value Syntax

```html
<!-- Spacing -->
<div class="w-[137px] h-[calc(100vh-64px)] m-[3.5rem]"></div>

<!-- Colors -->
<div class="bg-[#1da1f2] text-[rgb(255,0,0)] border-[hsl(0,100%,50%)]"></div>

<!-- Typography -->
<p class="text-[22px] leading-[1.7] tracking-[0.05em]"></p>

<!-- Grid -->
<div class="grid-cols-[1fr_2fr_1fr] gap-[clamp(1rem,5vw,3rem)]"></div>

<!-- Transforms -->
<div class="rotate-[17deg] translate-x-[calc(100%-1rem)]"></div>

<!-- Custom properties -->
<div class="bg-[var(--brand-color)] p-[var(--spacing)]"></div>

<!-- Arbitrary CSS -->
<div class="[mask-type:luminance] [clip-path:circle(50%)]"></div>
```

### State Modifier Stacking

```html
<!-- Multiple modifiers stack left-to-right -->
<div class="dark:md:hover:bg-blue-500">
  <!-- Applied when: dark mode + md breakpoint + hover -->
</div>

<div class="group-hover:md:text-lg">
  <!-- Applied when: parent group hovered + md breakpoint -->
</div>
```

---

**Last Updated**: 2026-01-01 | **Version**: 1.0.0
