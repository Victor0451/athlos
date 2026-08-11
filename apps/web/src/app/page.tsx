import { ProductLanding } from '@/components/landing/ProductLanding'
import { RootAuthHandoff } from '@/components/landing/RootAuthHandoff'

export default function Page() {
  return (
    <>
      <RootAuthHandoff />
      <ProductLanding />
    </>
  )
}
