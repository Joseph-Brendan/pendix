export const BRAND_COLOURS = {
  ink: "#0A0A0A",
  offBlack: "#1C1C1C",
  white: "#FFFFFF",
  offWhite: "#F6F5F2",
  line: "#E4E2DD",
  muted: "#6B6862",
  hotOrange: "#FF5A1F",
  orangeTint: "#FFF1EB",
} as const

export type BrandColourName = keyof typeof BRAND_COLOURS
export type BrandColourValue = (typeof BRAND_COLOURS)[BrandColourName]

export const BRAND_FONTS = {
  ui: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  code: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
} as const

export const BRAND_RADIUS = {
  base: "10px",
  px: 10,
} as const

export const BRAND_CSS_VARIABLES = `:root {
  --pendix-ink: ${BRAND_COLOURS.ink};
  --pendix-off-black: ${BRAND_COLOURS.offBlack};
  --pendix-white: ${BRAND_COLOURS.white};
  --pendix-off-white: ${BRAND_COLOURS.offWhite};
  --pendix-line: ${BRAND_COLOURS.line};
  --pendix-muted: ${BRAND_COLOURS.muted};
  --pendix-hot-orange: ${BRAND_COLOURS.hotOrange};
  --pendix-orange-tint: ${BRAND_COLOURS.orangeTint};
  --pendix-font-ui: ${BRAND_FONTS.ui};
  --pendix-font-code: ${BRAND_FONTS.code};
  --pendix-radius: ${BRAND_RADIUS.base};
}`

export const BRAND = {
  colours: BRAND_COLOURS,
  fonts: BRAND_FONTS,
  radius: BRAND_RADIUS,
  cssVariables: BRAND_CSS_VARIABLES,
} as const
