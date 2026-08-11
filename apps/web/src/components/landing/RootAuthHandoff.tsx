'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export function RootAuthHandoff() {
  const router = useRouter()
  useEffect(() => {
    if (getCurrentUser()) router.replace('/dashboard')
  }, [router])
  return null
}
