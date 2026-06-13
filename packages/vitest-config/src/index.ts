import type { InlineConfig } from 'vitest'
import { nodePreset } from './node.ts'
import { domPreset } from './dom.ts'

/**
 * The two preset flavors. Each is a function that returns an
 * `InlineConfig` fragment to be merged into a Vitest user config.
 */
export const presets = {
  node: nodePreset,
  dom: domPreset,
} as const

export type PresetName = keyof typeof presets

/**
 * Build a Vitest config for a package by selecting a preset and merging
 * package-specific overrides. Packages typically only need to override
 * `include` and (optionally) `coverage.include`.
 *
 * The returned object is a plain `InlineConfig`; Vitest's `defineConfig`
 * is a passthrough at the call site.
 */
export function createConfig(preset: PresetName, overrides?: Partial<InlineConfig>): InlineConfig {
  return {
    ...presets[preset](),
    ...overrides,
  }
}
