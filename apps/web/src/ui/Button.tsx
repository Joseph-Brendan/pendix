import type { ButtonHTMLAttributes } from "react"

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
}

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  // Primary is ink with white text.
  primary: "bg-ink text-white border border-ink hover:bg-off-black",
  // Hot orange accent: use at most once per screen; ink text preserves WCAG AA (>= 4.5:1) contrast.
  accent: "bg-hot-orange text-ink border border-hot-orange font-semibold hover:opacity-95",
  secondary: "bg-white text-ink border border-line hover:bg-off-white",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-off-white",
  danger: "bg-white text-ink border border-ink hover:bg-off-white",
}

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-pendix font-medium transition-colors cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot-orange",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  )
}
