import { BRAND_COLOURS, BRAND_FONTS, BRAND_RADIUS } from "@pendix/shared/brand"
import { CREDIT_COSTS } from "@pendix/shared/plans"
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components"
import { render } from "@react-email/render"
import type { EmailMessage } from "../mailer.js"

export interface WeeklyAssessmentEmailInput {
  readonly to: string
  readonly displayName: string
  readonly dueDate: string
  readonly assessmentUrl: string
  readonly isCreditUser: boolean
}

export function WeeklyAssessmentEmail(props: Omit<WeeklyAssessmentEmailInput, "to">) {
  const costNote = props.isCreditUser
    ? `Opening this check uses ${CREDIT_COSTS.assessment} credits after you confirm.`
    : "This check is included in your plan at no extra charge."

  return (
    <Html lang="en">
      <Head />
      <Preview>Your weekly check is ready. Five short questions from your own code this week.</Preview>
      <Body
        style={{
          backgroundColor: BRAND_COLOURS.offWhite,
          color: BRAND_COLOURS.ink,
          fontFamily: BRAND_FONTS.ui,
          margin: 0,
          padding: "32px 16px",
        }}
      >
        <Container
          style={{
            backgroundColor: BRAND_COLOURS.white,
            border: `1px solid ${BRAND_COLOURS.line}`,
            borderRadius: BRAND_RADIUS.base,
            maxWidth: "600px",
            margin: "0 auto",
            padding: "28px 28px 32px",
          }}
        >
          <Text
            style={{
              margin: "0 0 20px",
              fontSize: "16px",
              fontWeight: 700,
              color: BRAND_COLOURS.ink,
              letterSpacing: "-0.01em",
            }}
          >
            <span style={{ color: BRAND_COLOURS.hotOrange }}>●</span> pendix
          </Text>

          <Heading
            as="h1"
            style={{
              margin: "0 0 10px",
              fontSize: "22px",
              lineHeight: "28px",
              fontWeight: 700,
              color: BRAND_COLOURS.ink,
            }}
          >
            Your weekly check is ready
          </Heading>

          <Text style={{ margin: "0 0 14px", fontSize: "14px", lineHeight: "22px", color: BRAND_COLOURS.ink }}>
            Hi {props.displayName},
          </Text>
          <Text style={{ margin: "0 0 14px", fontSize: "14px", lineHeight: "22px", color: BRAND_COLOURS.ink }}>
            We built five short questions from the code you worked on this week. Complete it by {props.dueDate}. Late
            answers are still marked.
          </Text>
          <Text style={{ margin: "0 0 22px", fontSize: "13px", lineHeight: "20px", color: BRAND_COLOURS.muted }}>
            {costNote}
          </Text>

          <Section style={{ textAlign: "left" }}>
            <Button
              href={props.assessmentUrl}
              style={{
                backgroundColor: BRAND_COLOURS.hotOrange,
                borderRadius: BRAND_RADIUS.base,
                color: BRAND_COLOURS.white,
                display: "inline-block",
                fontSize: "14px",
                fontWeight: 600,
                padding: "12px 20px",
                textDecoration: "none",
              }}
            >
              Open weekly check
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export async function renderWeeklyAssessmentEmail(input: WeeklyAssessmentEmailInput): Promise<EmailMessage> {
  const html = await render(
    WeeklyAssessmentEmail({
      displayName: input.displayName,
      dueDate: input.dueDate,
      assessmentUrl: input.assessmentUrl,
      isCreditUser: input.isCreditUser,
    }),
  )

  const costNote = input.isCreditUser
    ? `Opening this check uses ${CREDIT_COSTS.assessment} credits after you confirm.`
    : "This check is included in your plan at no extra charge."

  const text = [
    `Hi ${input.displayName},`,
    "",
    "Your weekly check is ready.",
    `We built five short questions from your work this week. Due by ${input.dueDate}. Late answers are still marked.`,
    costNote,
    "",
    `Open your weekly check: ${input.assessmentUrl}`,
  ].join("\n")

  return {
    to: input.to,
    subject: "Your weekly check is ready",
    text,
    html,
  }
}
