'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface FeatureConfig {
  cashEnabled: boolean
  collectionsEnabled: boolean
  agreementsEnabled: boolean
}

const FeatureConfigContext = createContext<FeatureConfig>({
  cashEnabled: true,
  collectionsEnabled: false,
  agreementsEnabled: false,
})

export function FeatureConfigProvider({
  cashEnabled = true,
  collectionsEnabled = false,
  agreementsEnabled = false,
  children,
}: Partial<FeatureConfig> & { children: ReactNode }) {
  return (
    <FeatureConfigContext.Provider value={{ cashEnabled, collectionsEnabled, agreementsEnabled }}>
      {children}
    </FeatureConfigContext.Provider>
  )
}

export function useFeatureConfig(): FeatureConfig {
  return useContext(FeatureConfigContext)
}
