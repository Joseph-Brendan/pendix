import * as RadixTabs from "@radix-ui/react-tabs"
import type { ReactNode } from "react"

export interface TabItem {
  readonly value: string
  readonly label: string
  readonly content: ReactNode
}

export interface TabsProps {
  readonly defaultValue: string
  readonly items: readonly TabItem[]
  readonly className?: string
}

export function Tabs({ defaultValue, items, className = "" }: TabsProps) {
  return (
    <RadixTabs.Root defaultValue={defaultValue} className={`flex flex-col gap-4 ${className}`.trim()}>
      <RadixTabs.List className="inline-flex w-fit items-center gap-1 rounded-pendix border border-line bg-off-white p-1">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={[
              "rounded-[8px] px-3 py-1.5 text-sm font-medium text-muted transition-colors cursor-pointer",
              "data-[state=active]:bg-white data-[state=active]:text-ink data-[state=active]:border data-[state=active]:border-line",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot-orange",
            ].join(" ")}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content
          key={item.value}
          value={item.value}
          className="rounded-pendix focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot-orange"
        >
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}
