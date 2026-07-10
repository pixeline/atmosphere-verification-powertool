'use client'

import type { ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { verifierColorClass } from '@/lib/verifierColor'
import { describeLastActive } from '@/lib/activityBuckets'

type Verifier = { did: string; handle: string | null }

type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: Verifier[]
  indexed?: boolean
  lastActiveAt?: string | null
}

export function AccountCard({
  acc,
  selected,
  onToggle,
  actions,
}: {
  acc: Account
  selected?: boolean
  onToggle?: () => void
  actions?: ReactNode
}) {
  const verifiers = acc.verifiers ?? []
  const showSignals = acc.indexed !== false
  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="flex items-start gap-3">
        {onToggle && (
          <Checkbox
            id={`acc-${acc.did}`}
            checked={selected}
            onCheckedChange={onToggle}
            className="mt-1"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={onToggle ? `acc-${acc.did}` : undefined} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{acc.displayName || acc.handle}</span>
            <span className="text-muted-foreground">@{acc.handle}</span>
            {acc.isCustomDomain && <Badge variant="secondary">custom domain</Badge>}
            {acc.indexed === false && <Badge variant="secondary">Not yet indexed</Badge>}
            {verifiers.map((v) => {
              // A `<title>` child element (not a `title` attribute) is the
              // reliable, cross-browser way to get an SVG hover tooltip, and it
              // doubles as the icon's accessible name. Names the trusted
              // verifier so hovering a checkmark shows which one granted it.
              const label = `Verified by ${v.handle ?? v.did}`
              return (
                <CircleCheck
                  key={v.did}
                  role="img"
                  aria-label={label}
                  className={`size-4 ${verifierColorClass(v.did)}`}
                >
                  <title>{label}</title>
                </CircleCheck>
              )
            })}
          </Label>
          <a
            href={`https://mu.social/profile/${acc.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-xs text-primary underline-offset-2 hover:underline"
          >
            View on Mu ↗
          </a>
          {acc.description && <p className="text-sm text-muted-foreground">{acc.description}</p>}
          {showSignals && (
            <p className="text-xs text-muted-foreground">{describeLastActive(acc.lastActiveAt)}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </CardContent>
    </Card>
  )
}
