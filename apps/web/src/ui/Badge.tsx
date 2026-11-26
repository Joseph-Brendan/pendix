import type { HTMLAttributes } from "react"

export type BadgeVariant = "score" | "neutral" | "teach"

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: BadgeVariant
}

const BADGE_CLASSES: Readonly<Record<BadgeVariant, string>> = {
  // Scores: orange tint background, ink text.
  score: "bg-orange-tint text-ink border border-line font-semibold",
  neutral: "bg-off-white text-ink border border-line font-medium",
  teach: "bg-orange-tint text-ink border border-line font-medium",
}

export function Badge({ variant = "neutral", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pendix px-2.5 py-0.5 text-xs ${BADGE_CLASSES[variant]} ${className}`.trim()}
      {...props}
    >
      {variant === "teach" ? (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-hot-orange" />
      ) : null}
      {children}
    </span>
  )
}
