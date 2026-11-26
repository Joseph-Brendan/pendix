import * as RadixToast from "@radix-ui/react-toast"
import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

export interface ToastMessage {
  readonly id: number
  readonly title: string
  readonly description?: string
}

interface ToastContextValue {
  readonly showToast: (input: { readonly title: string; readonly description?: string }) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => undefined,
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([])

  const showToast = useCallback((input: { readonly title: string; readonly description?: string }) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setItems((prev) => [...prev, { id, title: input.title, description: input.description }])
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      <RadixToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {items.map((item) => (
          <RadixToast.Root
            key={item.id}
            open
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((x) => x.id !== item.id))
            }}
            className="flex items-start justify-between gap-3 rounded-pendix border border-line bg-white p-4 text-ink shadow-sm"
          >
            <div className="flex flex-col gap-0.5">
              <RadixToast.Title className="text-sm font-semibold text-ink">{item.title}</RadixToast.Title>
              {item.description ? (
                <RadixToast.Description className="text-xs text-muted">{item.description}</RadixToast.Description>
              ) : null}
            </div>
            <RadixToast.Close
              aria-label="Dismiss notification"
              className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-off-white hover:text-ink"
            >
              Dismiss
            </RadixToast.Close>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}
