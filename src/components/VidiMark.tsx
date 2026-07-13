// Round variant of the Vidi favicon (indigo disc + white check). Used as the
// header logomark and the login-screen brand mark. `fill-primary` ties it to
// the same brand indigo as CTAs and links.
export function VidiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" className="fill-primary" />
      <path
        d="M6.8 12.4l3.4 3.4L17.5 8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
