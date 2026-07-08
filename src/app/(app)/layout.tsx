'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOrg } from '@/lib/hooks/useOrg'
import { OnboardOrg } from '@/components/OnboardOrg'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const BASE_NAV_LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/members', label: 'Members' },
]

function ActorIdentity({ handle }: { handle: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {handle?.trim() ? (
          handle.trim().charAt(0).toUpperCase()
        ) : (
          <User className="size-4" />
        )}
      </span>
      {handle && <span className="hidden text-sm text-muted-foreground sm:inline">@{handle}</span>}
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { orgId, role, isAllowlisted, handle, authenticated, loading, verifiedCount, refresh } = useOrg()
  const navLinks = role === 'owner' ? [...BASE_NAV_LINKS, { href: '/settings', label: 'Settings' }] : BASE_NAV_LINKS

  async function signOut() {
    await fetch('/vidi/api/auth/logout', { method: 'POST' })
    window.location.href = '/vidi'
  }

  const orgResolved = !loading && authenticated && orgId == null

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <Link href="/search" className="text-lg font-semibold tracking-tight">
              Vidi
            </Link>
            {verifiedCount != null && (
              <span className="text-sm text-muted-foreground">{verifiedCount} verified</span>
            )}
          </div>
          <nav className="flex items-center gap-4">
            {navLinks.map((link) => (
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
          {authenticated && (
            <div className="ml-auto flex items-center gap-3">
              <ActorIdentity handle={handle} />
              <Button variant="outline" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {orgResolved && isAllowlisted && <OnboardOrg onOnboarded={refresh} />}
        {orgResolved && !isAllowlisted && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>No organization access yet</CardTitle>
              <CardDescription>
                You haven&apos;t been added to an organization yet. Ask an org owner to invite you.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
        {children}
      </main>
    </div>
  )
}
