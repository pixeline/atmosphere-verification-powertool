'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useOrg } from '@/lib/hooks/useOrg'
import { OnboardOrg } from '@/components/OnboardOrg'

const NAV_LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/members', label: 'Members' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { orgId, authenticated, loading, refresh } = useOrg()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link href="/search" className="text-lg font-semibold tracking-tight">
            Vidi
          </Link>
          <nav className="flex items-center gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'text-sm text-muted-foreground transition-colors hover:text-foreground',
                  pathname?.endsWith(link.href) && 'font-medium text-foreground'
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {!loading && authenticated && orgId == null && <OnboardOrg onOnboarded={refresh} />}
        {children}
      </main>
    </div>
  )
}
