'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
}

export function SearchForm({
  trustedVerifiers,
  onSearch,
}: {
  trustedVerifiers: TV[]
  onSearch: (filters: SearchFilters) => void
}) {
  const [text, setText] = useState('')
  const [customDomainOnly, setCustomDomainOnly] = useState(false)
  const [followedByVerified, setFollowedByVerified] = useState(false)
  const [verifiedByAnyOf, setVerifiedByAnyOf] = useState<string[]>([])

  return (
    <Card>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch({ text, customDomainOnly, followedByVerified, verifiedByAnyOf })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="search-text">Text in bio or handle</Label>
            <Input id="search-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="flex flex-col gap-3">
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-custom-domain"
                checked={customDomainOnly}
                onCheckedChange={(checked) => setCustomDomainOnly(checked === true)}
              />
              Handle is a domain
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-followed-by-verified"
                checked={followedByVerified}
                onCheckedChange={(checked) => setFollowedByVerified(checked === true)}
              />
              Followed by a verified account
            </Label>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Verified by</legend>
            {trustedVerifiers.map((tv) => (
              <Label key={tv.did} className="flex items-center gap-2">
                <Checkbox
                  id={`tv-${tv.did}`}
                  onCheckedChange={(checked) =>
                    setVerifiedByAnyOf((prev) =>
                      checked === true ? [...prev, tv.did] : prev.filter((d) => d !== tv.did)
                    )
                  }
                />
                {tv.handle}
              </Label>
            ))}
          </fieldset>

          <Button type="submit" className="self-start">
            Search
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
