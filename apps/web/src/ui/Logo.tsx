export interface LogoProps {
  readonly className?: string
}

export function Logo({ className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight text-ink ${className}`.trim()}>
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-hot-orange"
      />
      <span>pendix</span>
    </span>
  )
}
