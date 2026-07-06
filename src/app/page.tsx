'use client'
import { useState } from 'react'

export default function LoginPage() {
  const [handle, setHandle] = useState('')

  async function login() {
    const res = await fetch('/vidi/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    })
    const { url } = await res.json()
    window.location.href = url
  }

  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Vidi</h1>
      <p>Sign in with your atproto handle to verify accounts.</p>
      <input placeholder="you.handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
      <button onClick={login}>Sign in</button>
    </main>
  )
}
