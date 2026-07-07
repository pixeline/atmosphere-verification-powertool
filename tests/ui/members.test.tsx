import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import MembersPage, { MembersView } from '../../src/app/(app)/members/page'

afterEach(() => {
  cleanup()
})

describe('MembersView', () => {
  it('hides invite form for helpers', () => {
    render(<MembersView role="helper" members={[]} orgId={1} />)
    expect(screen.queryByText(/invite helper/i)).toBeNull()
  })
  it('shows invite form for owners', () => {
    render(<MembersView role="owner" members={[]} orgId={1} />)
    expect(screen.getByText(/invite helper/i)).toBeTruthy()
  })
})

function inviteButton() {
  return screen.getByRole('button', { name: /^invite$/i }) as HTMLButtonElement
}

async function flush() {
  // Advance past the 250ms typeahead debounce and let the fetch microtasks settle.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('MembersView invite typeahead', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('disables Invite until a suggestion is picked and re-disables on edit', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({
        actors: [{ did: 'did:plc:v4zpi', handle: 'pixeline.be', displayName: 'Pixeline' }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock as any)

    render(<MembersView role="owner" members={[]} orgId={1} />)

    // No selection yet -> disabled.
    expect(inviteButton().disabled).toBe(true)

    const input = screen.getByPlaceholderText('handle') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'pixe' } })
    await flush()

    const option = screen.getByText('@pixeline.be')
    // Still disabled — typing text alone must not enable submit.
    expect(inviteButton().disabled).toBe(true)

    act(() => {
      fireEvent.click(option)
    })
    expect(inviteButton().disabled).toBe(false)
    expect((screen.getByPlaceholderText('handle') as HTMLInputElement).value).toBe('pixeline.be')

    // Editing after picking clears the selection and re-disables.
    fireEvent.change(screen.getByPlaceholderText('handle'), { target: { value: 'pixeline.b' } })
    expect(inviteButton().disabled).toBe(true)

    expect(fetchMock.mock.calls[0][0]).toContain('/vidi/api/typeahead?q=')
  })

  it('POSTs handle + did from the picked suggestion, never from typed text', async () => {
    const calls: any[] = []
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      calls.push({ url, init })
      if (typeof url === 'string' && url.includes('/typeahead')) {
        return {
          ok: true,
          json: async () => ({
            actors: [{ did: 'did:plc:v4zpi74gy7enfiwke7hmoxv5', handle: 'pixeline.be' }],
          }),
        }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })
    vi.stubGlobal('fetch', fetchMock as any)
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
    })

    render(<MembersView role="owner" members={[]} orgId={9} />)
    fireEvent.change(screen.getByPlaceholderText('handle'), { target: { value: 'pixe' } })
    await flush()
    act(() => {
      fireEvent.click(screen.getByText('@pixeline.be'))
    })
    expect(inviteButton().disabled).toBe(false)

    await act(async () => {
      fireEvent.click(inviteButton())
      await Promise.resolve()
      await Promise.resolve()
    })

    const post = calls.find((c) => c.url === '/vidi/api/members')
    expect(post).toBeTruthy()
    expect(JSON.parse(post.init.body)).toEqual({
      orgId: 9,
      handle: 'pixeline.be',
      did: 'did:plc:v4zpi74gy7enfiwke7hmoxv5',
    })
  })
})

describe('MembersPage loading fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stops showing "Loading…" once org-context resolves to orgId null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ orgId: null, role: null, isAllowlisted: false, handle: null }),
      })) as any
    )

    render(<MembersPage />)

    // Once the context fetch resolves, the eternal "Loading…" must be gone.
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull())
  })
})
