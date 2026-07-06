import Link from 'next/link'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'system-ui' }}>
      <nav style={{ display: 'flex', gap: 16, padding: 12, borderBottom: '1px solid #ddd' }}>
        <strong>Vidi</strong>
        <Link href="/search">Search</Link>
        <Link href="/backlog">Backlog</Link>
        <Link href="/members">Members</Link>
      </nav>
      <main style={{ padding: 16 }}>{children}</main>
    </div>
  )
}
