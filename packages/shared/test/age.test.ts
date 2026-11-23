import { describe, expect, it } from "vitest"
import { accountKindFor, ageFromDob } from "../src/age.js"

describe("age", () => {
  it("classifies 15th and 18th birthday boundaries accurately", () => {
    const dob = "2010-06-15"
    expect(ageFromDob(dob, "2025-06-14")).toBe(14)
    expect(accountKindFor(dob, "2025-06-14")).toBe("blocked")

    expect(ageFromDob(dob, "2025-06-15")).toBe(15)
    expect(accountKindFor(dob, "2025-06-15")).toBe("teen")

    expect(ageFromDob(dob, "2028-06-14")).toBe(17)
    expect(accountKindFor(dob, "2028-06-14")).toBe("teen")

    expect(ageFromDob(dob, "2028-06-15")).toBe(18)
    expect(accountKindFor(dob, "2028-06-15")).toBe("adult")
  })

  it("turns over a 29 February birthday on 1 March in non-leap years", () => {
    // Born 2012-02-29: turns 15 in 2027 (non-leap year) on 1 March.
    expect(ageFromDob("2012-02-29", "2027-02-28")).toBe(14)
    expect(accountKindFor("2012-02-29", "2027-02-28")).toBe("blocked")
    expect(ageFromDob("2012-02-29", "2027-03-01")).toBe(15)
    expect(accountKindFor("2012-02-29", "2027-03-01")).toBe("teen")

    // Born 2008-02-29: turns 18 in 2026 (non-leap year) on 1 March.
    expect(ageFromDob("2008-02-29", "2026-02-28")).toBe(17)
    expect(accountKindFor("2008-02-29", "2026-02-28")).toBe("teen")
    expect(ageFromDob("2008-02-29", "2026-03-01")).toBe(18)
    expect(accountKindFor("2008-02-29", "2026-03-01")).toBe("adult")

    // In a leap year (2024), turns 16 on 29 February itself.
    expect(ageFromDob("2008-02-29", "2024-02-28")).toBe(15)
    expect(ageFromDob("2008-02-29", "2024-02-29")).toBe(16)
  })
})
