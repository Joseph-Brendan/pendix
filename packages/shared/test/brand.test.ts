import { describe, expect, it } from "vitest"
import { BRAND, BRAND_COLOURS, BRAND_CSS_VARIABLES, BRAND_FONTS, BRAND_RADIUS } from "../src/brand.js"

describe("brand", () => {
  it("exports all SPEC S2 colour tokens", () => {
    expect(BRAND_COLOURS).toEqual({
      ink: "#0A0A0A",
      offBlack: "#1C1C1C",
      white: "#FFFFFF",
      offWhite: "#F6F5F2",
      line: "#E4E2DD",
      muted: "#6B6862",
      hotOrange: "#FF5A1F",
      orangeTint: "#FFF1EB",
    })
  })

  it("exports Inter and JetBrains Mono font stacks with system fallbacks and 10px radius", () => {
    expect(BRAND_FONTS.ui).toContain("Inter")
    expect(BRAND_FONTS.ui).toContain("sans-serif")
    expect(BRAND_FONTS.code).toContain("JetBrains Mono")
    expect(BRAND_FONTS.code).toContain("monospace")
    expect(BRAND_RADIUS).toEqual({ base: "10px", px: 10 })
  })

  it("exports a CSS variables string for the web app", () => {
    expect(BRAND_CSS_VARIABLES).toContain(":root")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-ink: #0A0A0A;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-off-black: #1C1C1C;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-white: #FFFFFF;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-off-white: #F6F5F2;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-line: #E4E2DD;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-muted: #6B6862;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-hot-orange: #FF5A1F;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-orange-tint: #FFF1EB;")
    expect(BRAND_CSS_VARIABLES).toContain("--pendix-radius: 10px;")
    expect(BRAND.cssVariables).toBe(BRAND_CSS_VARIABLES)
  })
})
