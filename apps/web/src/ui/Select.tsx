import * as RadixSelect from "@radix-ui/react-select"
import { useId } from "react"

export interface SelectOption {
  readonly value: string
  readonly label: string
}

export interface SelectProps {
  readonly label: string
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly options: readonly SelectOption[]
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly id?: string
}

export function Select({
  label,
  value,
  onValueChange,
  options,
  placeholder = "Choose an option",
  disabled,
  id,
}: SelectProps) {
  const generatedId = useId()
  const triggerId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={triggerId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger
          id={triggerId}
          aria-label={label}
          className={[
            "inline-flex h-10 w-full items-center justify-between rounded-pendix border border-line bg-white px-3 text-sm text-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hot-orange",
            "disabled:bg-off-white disabled:text-muted disabled:cursor-not-allowed",
          ].join(" ")}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon aria-hidden="true" className="text-xs text-muted">
            v
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-pendix border border-line bg-white p-1 shadow-sm"
          >
            <RadixSelect.Viewport>
              {options.map((opt) => (
                <RadixSelect.Item
                  key={opt.value}
                  value={opt.value}
                  className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-off-white data-[state=checked]:font-semibold"
                >
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  )
}
