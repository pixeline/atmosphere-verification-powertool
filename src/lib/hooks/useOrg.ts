'use client'
import { useCallback, useEffect, useState } from 'react'

// v1: single-org context resolved from /vidi/api/org/context; stored in state.
export function useOrg() {
  const [orgId, setOrgId] = useState<number | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/vidi/api/org/context')
      setAuthenticated(res.status !== 401)
      const d = await res.json()
      setOrgId(d.orgId ?? null)
      setRole(d.role ?? null)
    } catch {
      setAuthenticated(false)
      setOrgId(null)
      setRole(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { orgId, setOrgId, role, authenticated, loading, refresh }
}
