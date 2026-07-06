'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

type Verifier = { did: string; handle: string | null }

type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiers?: Verifier[]
}

export function AccountCard({
  acc,
  selected,
  onToggle,
}: {
  acc: Account
  selected: boolean
  onToggle: () => void
}) {
  const verifiers = acc.verifiers ?? []
  return (
    <Card className="transition-colors hover:bg-muted/40">
      <CardContent className="flex items-start gap-3">
        <Checkbox
          id={`acc-${acc.did}`}
          checked={selected}
          onCheckedChange={onToggle}
          className="mt-1"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`acc-${acc.did}`} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{acc.displayName || acc.handle}</span>
            <span className="text-muted-foreground">@{acc.handle}</span>
            {acc.isCustomDomain && <Badge variant="secondary">custom domain</Badge>}
            {verifiers.length > 0 && (
              <Badge variant="outline">
                Verified by {verifiers.map((v) => v.handle ?? v.did).join(', ')}
              </Badge>
            )}
          </Label>
          <a
            href={`https://mu.social/profile/${acc.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            View on Mu ↗
          </a>
          {acc.description && <p className="text-sm text-muted-foreground">{acc.description}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
