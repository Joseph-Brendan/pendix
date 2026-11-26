import { BRAND_CSS_VARIABLES } from "@pendix/shared/brand"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { router } from "./router.js"
import "./styles/app.css"

function injectBrandTokens() {
  const existing = document.getElementById("pendix-brand-tokens")
  if (existing) return
  const style = document.createElement("style")
  style.id = "pendix-brand-tokens"
  style.textContent = BRAND_CSS_VARIABLES
  document.head.prepend(style)
}

injectBrandTokens()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
    },
  },
})

const rootEl = document.getElementById("root")
if (!rootEl) {
  throw new Error("Root element #root not found")
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
