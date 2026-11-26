import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { Logo } from "../ui/index.js"

export function AuthShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-screen bg-off-white text-ink flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-pendix focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:border focus:border-line"
      >
        Skip to main content
      </a>
      <header className="px-6 py-5">
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Link to="/" aria-label="Pendix home" className="rounded-md">
            <Logo className="text-lg" />
          </Link>
        </div>
      </header>
      <main id="main-content" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
