import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()

  return (
    <box>
      {dimensions().height < 12 ? null : (
        <box flexDirection="row" gap={1}>
          <text fg={theme.pendix.logoDot} attributes={TextAttributes.BOLD} selectable={false}>
            ●
          </text>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD} selectable={false}>
            pendix
          </text>
        </box>
      )}
    </box>
  )
}
