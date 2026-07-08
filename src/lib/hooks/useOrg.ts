'use client'
import { useCallback, useEffect, useState } from 'react'
import { subscribeVerifiedCountChanged } from '../verifiedCountBus'

// v1: single-org context resolved from /vidi/api/org/context; stored in state.
export function useOrg() {
  const [orgId, setOrgId] = useState<number | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [isAllowlisted, setIsAllowlisted] = useState<boolean>(false)
  const [handle, setHandle] = useState<string | null>(null)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [verifiedCount, setVerifiedCount] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/vidi/api/org/context')
      setAuthenticated(res.status !== 401)
      const d = await res.json()
      setOrgId(d.orgId ?? null)
      setRole(d.role ?? null)
      setIsAllowlisted(d.isAllowlisted ?? false)
      setHandle(d.handle ?? null)
      setVerifiedCount(d.verifiedCount ?? null)
    } catch {
      setAuthenticated(false)
      setOrgId(null)
      setRole(null)
      setIsAllowlisted(false)
      setHandle(null)
      setVerifiedCount(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Other components (e.g. a just-completed verify action) call
  // notifyVerifiedCountChanged() so every mounted useOrg() instance picks up
  // the new count without a full page reload — see verifiedCountBus.ts.
  useEffect(() => subscribeVerifiedCountChanged(refresh), [refresh])

  return { orgId, setOrgId, role, isAllowlisted, handle, authenticated, loading, verifiedCount, refresh }
}
