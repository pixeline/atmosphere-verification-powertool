'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  const [handle, setHandle] = useState('')
  const [loading, setLoading] = useState(false)

  async function login() {
    if (!handle.trim()) {
      toast.error('Enter your handle first')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/vidi/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ handle }),
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

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Vidi</CardTitle>
          <CardDescription>Sign in with your atproto handle to verify accounts.</CardDescription>
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
              <Input
                id="handle"
                placeholder="you.handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
