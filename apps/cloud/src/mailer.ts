import { Resend } from "resend"
import type { Logger } from "pino"

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>
}

export interface FakeMailer extends Mailer {
  readonly sent: EmailMessage[]
  clear(): void
}

export function createFakeMailer(): FakeMailer {
  const sent: EmailMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
    },
    clear() {
      sent.length = 0
    },
  }
}

export function createResendMailer(options: {
  readonly apiKey: string
  readonly from: string
  readonly logger?: Logger
}): Mailer {
  const key = options.apiKey.trim()
  const from = options.from.trim().replace(/^<([^<>]+)>$/, "$1")
  const resend = key ? new Resend(key) : null

  return {
    async send(message) {
      if (!resend) {
        options.logger?.info({ to: message.to, subject: message.subject }, "email skipped (RESEND_API_KEY not set)")
        return
      }
      const result = await resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      })
      if (result.error) {
        throw new Error(`Resend failed: ${result.error.message}`)
      }
    },
  }
}

export function buildVerificationEmail(input: { readonly to: string; readonly displayName: string; readonly url: string }): EmailMessage {
  const text = [
    `Hi ${input.displayName},`,
    "",
    "Verify your email address to activate your Pendix account.",
    "",
    input.url,
    "",
    "If you did not create a Pendix account, you can ignore this email.",
  ].join("\n")

  const html = `<p>Hi ${escapeHtml(input.displayName)},</p><p>Verify your email address to activate your Pendix account.</p><p><a href="${escapeHtml(input.url)}">Verify your email</a></p><p>If you did not create a Pendix account, you can ignore this email.</p>`

  return {
    to: input.to,
    subject: "Verify your Pendix email",
    text,
    html,
  }
}

export function buildGuardianApprovalEmail(input: {
  readonly to: string
  readonly teenDisplayName: string
  readonly approvalUrl: string
}): EmailMessage {
  const text = [
    "Hello,",
    "",
    `${input.teenDisplayName} asked to create a Pendix teen account (ages 15 to 17).`,
    "Pendix is a coding assistant and learning tool. Teen accounts need guardian approval before they can be used.",
    "",
    "Review and approve or decline within 7 days:",
    input.approvalUrl,
    "",
    "If you decline, the account and its data will be deleted.",
  ].join("\n")

  const html = `<p>Hello,</p><p>${escapeHtml(input.teenDisplayName)} asked to create a Pendix teen account (ages 15 to 17).</p><p>Pendix is a coding assistant and learning tool. Teen accounts need guardian approval before they can be used.</p><p><a href="${escapeHtml(input.approvalUrl)}">Review approval request</a> (expires in 7 days)</p><p>If you decline, the account and its data will be deleted.</p>`

  return {
    to: input.to,
    subject: `Approve ${input.teenDisplayName}'s Pendix account`,
    text,
    html,
  }
}

export function buildGuardianLoginEmail(input: { readonly to: string; readonly loginUrl: string }): EmailMessage {
  const text = [
    "Hello,",
    "",
    "Use this link to sign in to your Pendix guardian account:",
    input.loginUrl,
    "",
    "This link expires in 1 hour.",
  ].join("\n")

  const html = `<p>Hello,</p><p><a href="${escapeHtml(input.loginUrl)}">Sign in to your Pendix guardian account</a></p><p>This link expires in 1 hour.</p>`

  return {
    to: input.to,
    subject: "Sign in to Pendix",
    text,
    html,
  }
}

export function buildEighteenthBirthdayUserEmail(input: { readonly to: string; readonly displayName: string }): EmailMessage {
  const text = [
    `Happy 18th birthday, ${input.displayName}.`,
    "",
    "Your Pendix account is now an adult account. Teen limits have been removed.",
  ].join("\n")

  const html = `<p>Happy 18th birthday, ${escapeHtml(input.displayName)}.</p><p>Your Pendix account is now an adult account. Teen limits have been removed.</p>`

  return {
    to: input.to,
    subject: "Your Pendix account is now an adult account",
    text,
    html,
  }
}

export function buildEighteenthBirthdayGuardianEmail(input: {
  readonly to: string
  readonly teenDisplayName: string
}): EmailMessage {
  const text = [
    "Hello,",
    "",
    `${input.teenDisplayName} has turned 18. Their Pendix account has switched to an adult account and teen limits have been removed.`,
  ].join("\n")

  const html = `<p>Hello,</p><p>${escapeHtml(input.teenDisplayName)} has turned 18. Their Pendix account has switched to an adult account and teen limits have been removed.</p>`

  return {
    to: input.to,
    subject: `${input.teenDisplayName}'s Pendix account is now an adult account`,
    text,
    html,
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
