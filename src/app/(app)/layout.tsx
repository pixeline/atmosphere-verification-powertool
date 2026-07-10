'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
  const router = useRouter()
  const { orgId, role, isAllowlisted, handle, authenticated, loading, verifiedCount, refresh } = useOrg()
  const navLinks = role === 'owner' ? [...BASE_NAV_LINKS, { href: '/settings', label: 'Settings' }] : BASE_NAV_LINKS

  // Auth gate: the API routes already enforce authz server-side (returning
  // 401/403), but nothing was stopping the client shell from rendering for a
  // logged-out user — they could navigate a fully-broken UI instead of being
  // sent to sign in. Once auth resolves as unauthenticated, redirect to the
  // login page (root `/`, outside this route group, so no redirect loop).
  useEffect(() => {
    if (!loading && authenticated === false) router.replace('/')
  }, [loading, authenticated, router])

  // Keep the header's verified count honest as the user navigates: it can
  // change from actions on other pages or a background crawl, and the layout
  // stays mounted across client-side navigation (so it never re-fetches on its
  // own). Skip the initial mount — useOrg already fetches once then.
  const didMount = useRef(false)
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }
    refresh()
  }, [pathname, refresh])

  async function signOut() {
    await fetch('/vidi/api/auth/logout', { method: 'POST' })
    window.location.href = '/vidi'
  }

  // Don't render the app shell until auth is confirmed. While it's resolving —
  // or once we know the user is logged out and the redirect above is in
  // flight — show a neutral placeholder rather than a navigable-but-dead UI.
  if (loading || authenticated !== true) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
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
                  'text-sm text-muted-foreground transition-colors hover:text-primary',
                  pathname?.endsWith(link.href) && 'font-medium text-primary'
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
