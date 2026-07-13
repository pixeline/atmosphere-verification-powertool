'use client'
import { useEffect, useRef, useState } from 'react'
import { User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { VidiMark } from '@/components/VidiMark'

type Suggestion = {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

export default function LoginPage() {
  const [handle, setHandle] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  // Set when a suggestion is picked so the resulting value change does not
  // immediately re-open the dropdown from the debounced fetch effect.
  const justPickedRef = useRef(false)

  async function login() {
    if (!handle.trim()) {
      toast.error('Enter your handle first')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/vidi/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ handle: handle.trim() }),
      })
      if (!res.ok) {
        toast.error('Could not start sign in')
        return
      }
      const { url } = await res.json()
      window.location.href = url
    } catch {
      toast.error('Could not start sign in')
    } finally {
      setLoading(false)
    }
  }

  // Debounced typeahead: fire only for 2+ chars, 250ms after the last keystroke.
  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false
      return
    }
    const term = handle.trim()
    if (term.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/vidi/api/typeahead?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const { actors } = await res.json()
        setSuggestions(actors ?? [])
        setOpen((actors ?? []).length > 0)
      } catch {
        /* aborted or network error — ignore */
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [handle])

  // Click-outside to close the dropdown.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  function pick(s: Suggestion) {
    justPickedRef.current = true
    setHandle(s.handle)
    setOpen(false)
    setSuggestions([])
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm overflow-visible">
        <CardHeader className="flex flex-col items-center gap-1.5 text-center">
          <VidiMark className="size-12 shrink-0" />
          <CardTitle className="text-2xl font-semibold tracking-tight">Vidi</CardTitle>
          <CardDescription>
            Vidi helps Mu Trusted Verifiers find and verify authentic accounts across the network.
          </CardDescription>
          <CardDescription>Sign in with your atproto handle to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              login()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="handle">Handle</Label>
              <div ref={containerRef} className="relative">
                <Input
                  id="handle"
                  placeholder="you.handle"
                  value={handle}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={open}
                  onChange={(e) => setHandle(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false)
                  }}
                  autoFocus
                />
                {open && suggestions.length > 0 && (
                  <ul
                    role="listbox"
                    className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
                  >
                    {suggestions.map((s) => (
                      <li key={s.did}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => pick(s)}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        >
                          {s.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={s.avatar}
                              alt=""
                              className="size-7 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                              {s.displayName?.trim() ? (
                                s.displayName.trim().charAt(0).toUpperCase()
                              ) : (
                                <User className="size-4" />
                              )}
                            </span>
                          )}
                          <span className="flex min-w-0 flex-col">
                            {s.displayName && (
                              <span className="truncate text-sm font-medium leading-tight">
                                {s.displayName}
                              </span>
                            )}
                            <span className="truncate text-xs text-muted-foreground leading-tight">
                              @{s.handle}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
