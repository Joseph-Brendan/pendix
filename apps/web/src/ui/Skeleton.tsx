import type { HTMLAttributes } from "react"

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-pendix bg-line/70 ${className}`.trim()}
      {...props}
    />
  )
}
