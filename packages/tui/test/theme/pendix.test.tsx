/** @jsxImportSource @opentui/solid */
import { RGBA, TextRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { resolveThemeDocument, type ResolvedTheme } from "@pendix/theme/tui"
import { BRAND_COLOURS } from "@pendix/shared/brand"
import { ConfigProvider, resolve, type Info } from "../../src/config"
import { Logo } from "../../src/component/logo"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { allThemes, DEFAULT_THEME_NAME, getPendixTheme, hasTheme } from "../../src/theme"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"

const HOT_ORANGE = BRAND_COLOURS.hotOrange
const ORANGE_TINT = BRAND_COLOURS.orangeTint

const ALLOWED_ORANGE_TOKENS = [
  "background.action.primary.focused",
  "border.focused",
  "pendix.logoDot",
  "pendix.mainActionHint",
  "pendix.scoreBadge",
  "pendix.teachModeTag",
  "text.action.primary.selected",
  "text.formfield.selected",
] as const

function toHex(color: RGBA) {
  if (color.a === 0) return "transparent"
  const [r, g, b] = color.toInts()
  const hex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase()
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function serializeTokenMap(theme: ResolvedTheme): Record<string, string> {
  const entries: [string, string][] = []

  const visit = (value: unknown, prefix: string) => {
    if (value instanceof RGBA) {
      entries.push([prefix, toHex(value)])
      return
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "function") continue
      visit(item, prefix ? `${prefix}.${key}` : key)
    }
  }

  visit(
    {
      text: theme.text,
      background: theme.background,
      border: theme.border,
      scrollbar: theme.scrollbar,
      diff: theme.diff,
      syntax: theme.syntax,
      markdown: theme.markdown,
      pendix: theme.pendix,
    },
    "",
  )

  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

function descendants(root: Renderable): Renderable[] {
  return root.getChildren().flatMap((child) => [child, ...descendants(child)])
}

test("default theme name is pendix and upstream themes remain available", () => {
  expect(DEFAULT_THEME_NAME).toBe("pendix")
  expect(hasTheme("pendix")).toBeTrue()
  expect(allThemes().pendix).toBe(getPendixTheme())
  for (const upstream of ["opencode", "opencode-classic", "tokyonight", "dracula", "github", "system"]) {
    expect(hasTheme(upstream)).toBeTrue()
  }
})

test.each(["dark", "light"] as const)("matches Pendix %s theme token snapshot", (mode) => {
  const resolved = resolveThemeDocument(getPendixTheme(), mode)
  const tokens = serializeTokenMap(resolved)
  const dialogTokens = serializeTokenMap(resolved.surface("dialog"))

  expect({
    mode,
    accent: toHex(resolved.hue.accent[400]),
    tokens,
    dialog: {
      backgroundBase: dialogTokens["background.base"],
      borderBase: dialogTokens["border.base"],
      borderFocused: dialogTokens["border.focused"],
      actionPrimaryFocusedBg: dialogTokens["background.action.primary.focused"],
      actionPrimaryHoveredBg: dialogTokens["background.action.primary.hovered"],
    },
  }).toMatchSnapshot()
})

test.each(["dark", "light"] as const)(
  "uses hot orange only on the listed elements in %s mode",
  (mode) => {
    const resolved = resolveThemeDocument(getPendixTheme(), mode)
    const surfaces = [
      ["base", resolved],
      ["dialog", resolved.surface("dialog")],
      ["dialog.footer", resolved.surface("dialog.footer")],
    ] as const

    for (const [surfaceName, view] of surfaces) {
      const tokenMap = serializeTokenMap(view)
      const orangeTokens = Object.entries(tokenMap)
        .filter(([, value]) => value === HOT_ORANGE)
        .map(([key]) => key)
        .sort()

      expect(orangeTokens, `orange tokens on ${surfaceName} (${mode})`).toEqual([...ALLOWED_ORANGE_TOKENS])

      const orangeTintTokens = Object.entries(tokenMap)
        .filter(([, value]) => value === ORANGE_TINT)
        .map(([key]) => key)
      expect(orangeTintTokens, `orange tint tokens on ${surfaceName} (${mode})`).toEqual([])

      // Categorical colors used for agents/skills/stats stay neutral.
      for (const scale of view.categorical) {
        for (const color of Object.values(scale)) {
          expect(toHex(color)).not.toBe(HOT_ORANGE)
          expect(toHex(color)).not.toBe(ORANGE_TINT)
        }
      }
    }
  },
)

test.each([
  {
    mode: "dark" as const,
    background: BRAND_COLOURS.offBlack,
    text: BRAND_COLOURS.offWhite,
    border: BRAND_COLOURS.muted,
  },
  {
    mode: "light" as const,
    background: BRAND_COLOURS.offWhite,
    text: BRAND_COLOURS.ink,
    border: BRAND_COLOURS.line,
  },
])("uses pendix as the default theme in %s terminals", async ({ mode, background, text, border }) => {
  await using temporary = await tmpdir()
  const settings: Info = {}
  let theme!: ReturnType<typeof useTheme>
  let themes!: ReturnType<typeof useThemes>

  function Probe() {
    theme = useTheme()
    themes = useThemes()
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <ConfigProvider
          config={resolve(settings, { terminalSuspend: process.platform !== "win32", environment: {} })}
          service={{ get: async () => settings, update: async () => settings }}
        >
          <ThemeProvider mode={mode} source={emptyThemeSource}>
            <Probe />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )

  try {
    app.renderer.start()
    await app.waitFor(() => themes?.ready === true)
    expect(themes.selected).toBe("pendix")
    expect(themes.mode()).toBe(mode)
    expect(toHex(theme.background.base)).toBe(background)
    expect(toHex(theme.text.base)).toBe(text)
    expect(toHex(theme.border.base)).toBe(border)
    expect(toHex(theme.border.focused)).toBe(HOT_ORANGE)
    expect(toHex(theme.hue.accent[400])).toBe(HOT_ORANGE)
  } finally {
    app.renderer.destroy()
  }
})

test.each(["dark", "light"] as const)("start screen Logo renders lowercase pendix with an orange dot in %s mode", async (mode) => {
  await using temporary = await tmpdir()
  const settings: Info = {}

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <ConfigProvider
          config={resolve(settings, { terminalSuspend: process.platform !== "win32", environment: {} })}
          service={{ get: async () => settings, update: async () => settings }}
        >
          <ThemeProvider mode={mode} source={emptyThemeSource}>
            <Logo />
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("● pendix")
    expect(frame).not.toContain("█▀▀█")

    const texts = descendants(app.renderer.root).filter(
      (node): node is TextRenderable => node instanceof TextRenderable,
    )
    const dot = texts.find((node) => node.plainText === "●")
    const wordmark = texts.find((node) => node.plainText === "pendix")
    expect(dot).toBeDefined()
    expect(wordmark).toBeDefined()
    expect(dot!.x).toBeLessThan(wordmark!.x)
    expect(toHex(dot!.fg)).toBe(HOT_ORANGE)
    expect(toHex(wordmark!.fg)).toBe(mode === "dark" ? BRAND_COLOURS.offWhite : BRAND_COLOURS.ink)
  } finally {
    app.renderer.destroy()
  }
})
