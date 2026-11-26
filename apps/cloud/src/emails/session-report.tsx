import { BRAND_COLOURS, BRAND_FONTS, BRAND_RADIUS } from "@pendix/shared/brand"
import type { SessionNotes } from "@pendix/shared/rubric"
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components"
import { render } from "@react-email/render"
import type { EmailMessage } from "../mailer.js"

export interface WeakestPromptSummary {
  readonly promptIndex: number
  readonly original: string
  readonly score: number
  readonly improved: string
  readonly why: string
}

export interface SessionReportEmailInput {
  readonly to: string
  readonly displayName: string
  readonly sessionTitle: string
  readonly sessionDate: string
  readonly promptScore: number
  readonly understandingScore: number
  readonly understandingReason: string
  readonly weakestPrompts: readonly WeakestPromptSummary[]
  readonly notes: SessionNotes
  readonly reportUrl: string
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? `${score}/10` : `${score.toFixed(1)}/10`
}

export function SessionReportEmail(props: Omit<SessionReportEmailInput, "to">) {
  const promptScoreLabel = `${props.promptScore.toFixed(1)}/10`
  const understandingLabel = formatScore(props.understandingScore)

  return (
    <Html lang="en">
      <Head />
      <Preview>
        {`Pendix report for ${props.sessionTitle}: prompt score ${promptScoreLabel}, understanding ${understandingLabel}`}
      </Preview>
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
              margin: "0 0 6px",
              fontSize: "22px",
              lineHeight: "28px",
              fontWeight: 700,
              color: BRAND_COLOURS.ink,
            }}
          >
            {props.sessionTitle}
          </Heading>
          <Text
            style={{
              margin: "0 0 20px",
              fontSize: "13px",
              color: BRAND_COLOURS.muted,
            }}
          >
            Session report for {props.displayName} on {props.sessionDate}
          </Text>

          <Section
            style={{
              backgroundColor: BRAND_COLOURS.offWhite,
              border: `1px solid ${BRAND_COLOURS.line}`,
              borderRadius: BRAND_RADIUS.base,
              padding: "16px 18px",
              marginBottom: "22px",
            }}
          >
            <Text style={{ margin: "0 0 6px", fontSize: "14px", color: BRAND_COLOURS.ink }}>
              <strong>Prompt score:</strong> {promptScoreLabel}
            </Text>
            <Text style={{ margin: "0 0 6px", fontSize: "14px", color: BRAND_COLOURS.ink }}>
              <strong>Understanding score:</strong> {understandingLabel}
            </Text>
            <Text style={{ margin: 0, fontSize: "13px", color: BRAND_COLOURS.muted }}>
              {props.understandingReason}
            </Text>
          </Section>

          <Heading
            as="h2"
            style={{
              margin: "0 0 10px",
              fontSize: "16px",
              fontWeight: 700,
              color: BRAND_COLOURS.ink,
            }}
          >
            Session notes
          </Heading>
          <Text style={{ margin: "0 0 12px", fontSize: "14px", lineHeight: "21px", color: BRAND_COLOURS.ink }}>
            <strong>What was built:</strong> {props.notes.what_was_built}
          </Text>
          <Text style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 600, color: BRAND_COLOURS.ink }}>
            Three things learned
          </Text>
          {props.notes.things_learned.map((item, idx) => (
            <Text
              key={`learned-${idx}`}
              style={{ margin: "0 0 4px", fontSize: "14px", lineHeight: "20px", color: BRAND_COLOURS.ink }}
            >
              {idx + 1}. {item}
            </Text>
          ))}
          <Text style={{ margin: "12px 0 6px", fontSize: "14px", fontWeight: 600, color: BRAND_COLOURS.ink }}>
            Two things to work on
          </Text>
          {props.notes.things_to_work_on.map((item, idx) => (
            <Text
              key={`work-${idx}`}
              style={{ margin: "0 0 4px", fontSize: "14px", lineHeight: "20px", color: BRAND_COLOURS.ink }}
            >
              {idx + 1}. {item}
            </Text>
          ))}

          {props.weakestPrompts.length > 0 && (
            <>
              <Hr style={{ borderColor: BRAND_COLOURS.line, margin: "22px 0" }} />
              <Heading
                as="h2"
                style={{
                  margin: "0 0 12px",
                  fontSize: "16px",
                  fontWeight: 700,
                  color: BRAND_COLOURS.ink,
                }}
              >
                Prompts to improve
              </Heading>
              {props.weakestPrompts.map((item) => (
                <Section
                  key={`weak-${item.promptIndex}`}
                  style={{
                    border: `1px solid ${BRAND_COLOURS.line}`,
                    borderRadius: BRAND_RADIUS.base,
                    padding: "14px 16px",
                    marginBottom: "12px",
                  }}
                >
                  <Text style={{ margin: "0 0 6px", fontSize: "12px", color: BRAND_COLOURS.muted }}>
                    Prompt #{item.promptIndex + 1} (score {item.score}/10)
                  </Text>
                  <Text
                    style={{
                      margin: "0 0 8px",
                      fontSize: "13px",
                      fontFamily: BRAND_FONTS.code,
                      color: BRAND_COLOURS.offBlack,
                    }}
                  >
                    {item.original}
                  </Text>
                  <Text style={{ margin: "0 0 6px", fontSize: "13px", color: BRAND_COLOURS.muted }}>
                    <strong>Why:</strong> {item.why}
                  </Text>
                  <Text style={{ margin: 0, fontSize: "13px", color: BRAND_COLOURS.ink }}>
                    <strong>Stronger version:</strong> {item.improved}
                  </Text>
                </Section>
              ))}
            </>
          )}

          <Section style={{ marginTop: "24px", textAlign: "left" }}>
            <Button
              href={props.reportUrl}
              style={{
                backgroundColor: BRAND_COLOURS.hotOrange,
                color: BRAND_COLOURS.white,
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
                padding: "12px 20px",
                borderRadius: BRAND_RADIUS.base,
                display: "inline-block",
              }}
            >
              See full report
            </Button>
          </Section>

          <Text style={{ margin: "20px 0 0", fontSize: "12px", color: BRAND_COLOURS.muted }}>
            You can turn off session report emails anytime in your Pendix dashboard settings.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export async function renderSessionReportEmail(input: SessionReportEmailInput): Promise<EmailMessage> {
  const { to, ...templateProps } = input
  const html = await render(<SessionReportEmail {...templateProps} />)

  const textLines = [
    `Pendix session report: ${input.sessionTitle} (${input.sessionDate})`,
    "",
    `Prompt score: ${input.promptScore.toFixed(1)}/10`,
    `Understanding score: ${formatScore(input.understandingScore)} (${input.understandingReason})`,
    "",
    `What was built: ${input.notes.what_was_built}`,
    "",
    "Three things learned:",
    ...input.notes.things_learned.map((item, idx) => `${idx + 1}. ${item}`),
    "",
    "Two things to work on:",
    ...input.notes.things_to_work_on.map((item, idx) => `${idx + 1}. ${item}`),
  ]

  if (input.weakestPrompts.length > 0) {
    textLines.push("", "Prompts to improve:")
    for (const item of input.weakestPrompts) {
      textLines.push(
        `- Prompt #${item.promptIndex + 1} (${item.score}/10): ${item.original}`,
        `  Why: ${item.why}`,
        `  Stronger version: ${item.improved}`,
      )
    }
  }

  textLines.push("", `See full report: ${input.reportUrl}`)

  return {
    to,
    subject: `Session graded (${input.promptScore.toFixed(1)}/10): ${input.sessionTitle}`,
    text: textLines.join("\n"),
    html,
  }
}
