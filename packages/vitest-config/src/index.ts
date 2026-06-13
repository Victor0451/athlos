import { defineConfig, type ConfigBase } from 'vitest/config'
import { nodePreset } from './node'
import { domPreset } from './dom'

/**
 * The two preset flavors. Each is a function that returns a `ConfigBase`
 * fragment to be merged into a Vitest user config.
 */
export const presets = {
  node: nodePreset,
  dom: domPreset,
} as const

export type PresetName = keyof typeof presets

/**
 * Build a Vitest config for a package by selecting a preset and merging
 * package-specific overrides. Packages typically only need to override
 * test.include and (optionally) test.coverage.include.
 */
export function createConfig(preset: PresetName, overrides?: Partial<ConfigBase>) {
  return defineConfig({
    ...presets[preset](),
    ...overrides,
  })
}

// Re-export `defineConfig` so consumers that need a fully custom config
// (rare) can still use the same import path.
export { defineConfig }
