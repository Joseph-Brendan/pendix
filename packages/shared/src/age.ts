export type AccountKind = "blocked" | "teen" | "adult"
export type DateInput = Date | string

interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function parseCalendarDate(input: DateInput, label: string): CalendarDate {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new RangeError(`Invalid ${label}: invalid Date`)
    }
    return {
      year: input.getUTCFullYear(),
      month: input.getUTCMonth() + 1,
      day: input.getUTCDate(),
    }
  }

  const match = ISO_DATE_PATTERN.exec(input)
  if (!match) {
    throw new RangeError(`Invalid ${label}: expected YYYY-MM-DD, got "${input}"`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid ${label}: "${input}" is not a valid calendar date`)
  }
  return { year, month, day }
}

export function ageFromDob(dob: DateInput, today: DateInput = new Date()): number {
  const birth = parseCalendarDate(dob, "dob")
  const now = parseCalendarDate(today, "today")

  let age = now.year - birth.year
  const birthdayReached =
    birth.month === 2 && birth.day === 29 && !isLeapYear(now.year)
      ? // In non-leap years, a 29 February birthday turns over on 1 March.
        now.month > 2
      : now.month > birth.month || (now.month === birth.month && now.day >= birth.day)

  if (!birthdayReached) age -= 1
  return age
}

export function accountKindFor(dob: DateInput, today: DateInput = new Date()): AccountKind {
  const age = ageFromDob(dob, today)
  if (age < 15) return "blocked"
  if (age < 18) return "teen"
  return "adult"
}
