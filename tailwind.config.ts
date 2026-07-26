import type { Config } from 'tailwindcss';

/**
 * Default theme only.
 *
 * The constitution's Principle V puts a custom colour system and any theming layer
 * out of scope for v1: "Styling for v1 is clean and default. No logo system, no
 * custom color system, no theming layer." `theme.extend` is therefore deliberately
 * empty — reach for Tailwind's defaults rather than adding tokens here.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
