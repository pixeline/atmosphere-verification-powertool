'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useOrg } from '@/lib/hooks/useOrg'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type BacklogItem = { subjectDid: string }

export default function BacklogPage() {
  const { orgId } = useOrg()
  const [items, setItems] = useState<BacklogItem[]>([])

  useEffect(() => {
    if (orgId) {
      fetch(`/vidi/api/backlog?orgId=${orgId}`)
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
    }
  }, [orgId])

  async function act(subjectDid: string, status: string) {
    const res = await fetch('/vidi/api/backlog', {
      method: 'PATCH',
      body: JSON.stringify({ orgId, subjectDid, status }),
    })
    if (!res.ok) {
      toast.error('Could not update backlog item')
      return
    }
    setItems((p) => p.filter((i) => i.subjectDid !== subjectDid))
    toast.success(status === 'verified' ? 'Marked verified' : 'Skipped')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>To Be Verified</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing pending review.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.subjectDid}>
                  <TableCell className="font-mono text-xs">{i.subjectDid}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <Button size="sm" onClick={() => act(i.subjectDid, 'verified')}>
                      Mark verified
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => act(i.subjectDid, 'skipped')}>
                      Skip
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
