'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
  liveNetwork: boolean
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
  const [liveNetwork, setLiveNetwork] = useState(false)

  function setScope(live: boolean) {
    setLiveNetwork(live)
    if (live) {
      setFollowedByVerified(false)
      setVerifiedByAnyOf([])
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch({ text, customDomainOnly, followedByVerified, verifiedByAnyOf, liveNetwork })
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="search-text">Search in bio or handle</Label>
            <Input id="search-text" value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Filters</p>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-custom-domain"
                checked={customDomainOnly}
                onCheckedChange={(checked) => setCustomDomainOnly(checked === true)}
              />
              Only domain handles (e.g. lalibre.be)
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-followed-by-verified"
                checked={followedByVerified}
                disabled={liveNetwork}
                onCheckedChange={(checked) => setFollowedByVerified(checked === true)}
              />
              Followed by a verified account
            </Label>
            {trustedVerifiers.length > 0 && (
              <fieldset className="flex flex-col gap-3 pl-6">
                <legend className="mb-1 text-sm font-medium">Verified by</legend>
                {trustedVerifiers.map((tv) => (
                  <Label key={tv.did} className="flex items-center gap-2">
                    <Checkbox
                      id={`tv-${tv.did}`}
                      checked={verifiedByAnyOf.includes(tv.did)}
                      disabled={liveNetwork}
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
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Search in</Label>
            <div role="group" aria-label="Search scope" className="inline-flex w-fit gap-1 rounded-lg border border-border p-1">
              <Button
                type="button"
                size="sm"
                variant={liveNetwork ? 'ghost' : 'default'}
                aria-pressed={!liveNetwork}
                onClick={() => setScope(false)}
              >
                Harvested accounts
              </Button>
              <Button
                type="button"
                size="sm"
                variant={liveNetwork ? 'default' : 'ghost'}
                aria-pressed={liveNetwork}
                onClick={() => setScope(true)}
              >
                Live network
              </Button>
            </div>
            {liveNetwork && (
              <p className="text-xs text-muted-foreground">
                Requires text above. Only matches text/domain — verified-by filters don&apos;t apply live.
              </p>
            )}
          </div>

          <Button type="submit" className="self-start">
            Search
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
