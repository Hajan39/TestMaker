import { Suspense } from 'react'
import { googleNastaveni } from '@/lib/google'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Přihlášení – TestMaker' }

export default function LoginPage() {
  // Tlačítko Googlu se nabízí, jen když je nastavené — stejná zásada jako
  // u generování: co nejde použít, se nezobrazuje.
  const googleZapnuty = googleNastaveni() !== null

  return (
    // `useSearchParams` ve formuláři potřebuje hranici se Suspense.
    <Suspense>
      <LoginForm googleZapnuty={googleZapnuty} />
    </Suspense>
  )
}
