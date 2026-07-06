'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'

type Account = {
  did: string
  handle: string
  displayName?: string | null
  description?: string | null
  isCustomDomain?: boolean
  verifiedBy?: string[]
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
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        id={`acc-${acc.did}`}
        checked={selected}
        onCheckedChange={onToggle}
        className="mt-1"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label htmlFor={`acc-${acc.did}`} className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{acc.displayName || acc.handle}</span>
          <span className="text-muted-foreground">@{acc.handle}</span>
          {acc.isCustomDomain && <Badge variant="secondary">custom domain</Badge>}
          {acc.verifiedBy?.map((v) => (
            <Badge key={v} variant="outline">
              verified by {v}
            </Badge>
          ))}
        </Label>
        {acc.description && <p className="text-sm text-muted-foreground">{acc.description}</p>}
      </div>
    </div>
  )
}
