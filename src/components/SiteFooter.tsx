// Global footer, rendered once in the root layout so it appears on every page
// (login screen and the authenticated app shell alike). Credits the author and
// links to their mu.social (Mastodon) profile.
export function SiteFooter() {
  return (
    <footer className="border-t bg-background py-4 text-center text-sm text-muted-foreground">
      made by{' '}
      <a
        href="https://mu.social/@pixeline.be"
        target="_blank"
        rel="me noopener noreferrer"
        className="font-medium text-primary underline-offset-4 transition-colors hover:underline"
      >
        pixeline.be
      </a>
    </footer>
  )
}
