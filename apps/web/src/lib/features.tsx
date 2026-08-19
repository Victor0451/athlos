'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface FeatureConfig {
  cashEnabled: boolean
}

const FeatureConfigContext = createContext<FeatureConfig>({ cashEnabled: true })

export function FeatureConfigProvider({
  cashEnabled,
  children,
}: FeatureConfig & { children: ReactNode }) {
  return (
    <FeatureConfigContext.Provider value={{ cashEnabled }}>
      {children}
    </FeatureConfigContext.Provider>
  )
}

export function useFeatureConfig(): FeatureConfig {
  return useContext(FeatureConfigContext)
}
