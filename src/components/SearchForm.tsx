'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ACTIVITY_BUCKETS } from '@/lib/activityBuckets'

type TV = { did: string; handle: string }

export type SearchFilters = {
  text: string
  customDomainOnly: boolean
  followedByVerified: boolean
  verifiedByAnyOf: string[]
  liveNetwork: boolean
  activeWithinDays: number | null
  excludeVerifiedByUs: boolean
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
  const [activeWithinDays, setActiveWithinDays] = useState<number | null>(null)
  const [excludeVerifiedByUs, setExcludeVerifiedByUs] = useState(true)

  function setScope(live: boolean) {
    setLiveNetwork(live)
    if (live) {
      setFollowedByVerified(false)
      setVerifiedByAnyOf([])
      setActiveWithinDays(null)
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
            onSearch({
              text,
              customDomainOnly,
              followedByVerified,
              verifiedByAnyOf,
              liveNetwork,
              activeWithinDays,
              excludeVerifiedByUs,
            })
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
                id="search-exclude-verified-by-us"
                checked={excludeVerifiedByUs}
                onCheckedChange={(checked) => setExcludeVerifiedByUs(checked === true)}
              />
              Hide accounts already verified by us
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox
                id="search-followed-by-verified"
                checked={followedByVerified}
                disabled={liveNetwork}
                onCheckedChange={(checked) => {
                  const isChecked = checked === true
                  setFollowedByVerified(isChecked)
                  // "Verified by" only makes sense — and is only shown — as a
                  // refinement of this filter, so clear it when hidden rather
                  // than leaving a stale, invisible filter still applied.
                  if (!isChecked) setVerifiedByAnyOf([])
                }}
              />
              Followed by a verified account
            </Label>
            {followedByVerified && trustedVerifiers.length > 0 && (
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
            <Label>Active within</Label>
            <div role="group" aria-label="Activity timeframe" className="inline-flex w-fit flex-wrap gap-1 rounded-lg border border-border p-1">
              {ACTIVITY_BUCKETS.map((b) => (
                <Button
                  key={b.days}
                  type="button"
                  size="sm"
                  variant={activeWithinDays === b.days ? 'default' : 'ghost'}
                  aria-pressed={activeWithinDays === b.days}
                  disabled={liveNetwork}
                  onClick={() => setActiveWithinDays(b.days)}
                >
                  {b.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={activeWithinDays === null ? 'default' : 'ghost'}
                aria-pressed={activeWithinDays === null}
                disabled={liveNetwork}
                onClick={() => setActiveWithinDays(null)}
              >
                Any time
              </Button>
            </div>
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
