import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router"
import { AssessmentDetailPage } from "./pages/AssessmentDetailPage.js"
import { AssessmentsPage } from "./pages/AssessmentsPage.js"
import { BillingPage } from "./pages/BillingPage.js"
import { DesignPage } from "./pages/DesignPage.js"
import { DeviceVerifyPage } from "./pages/DeviceVerifyPage.js"
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js"
import { GuardianApprovalPage } from "./pages/GuardianApprovalPage.js"
import { HomePage } from "./pages/HomePage.js"
import { SessionDetailPage } from "./pages/SessionDetailPage.js"
import { SessionsPage } from "./pages/SessionsPage.js"
import { SettingsPage } from "./pages/SettingsPage.js"
import { SignInPage } from "./pages/SignInPage.js"
import { SignUpPage } from "./pages/SignUpPage.js"
import { VerifyEmailPage } from "./pages/VerifyEmailPage.js"
import { ToastProvider } from "./ui/index.js"

const rootRoute = createRootRoute({
  component: () => (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  ),
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
})

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: SignUpPage,
})

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signin",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: SignInPage,
})

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    verified: search.verified === "1" || search.verified === 1 || search.verified === true ? "1" : undefined,
  }),
  component: VerifyEmailPage,
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
})

const guardianApprovalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guardian/approval/$token",
  component: GuardianApprovalPage,
})

const deviceVerifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/device/verify",
  validateSearch: (search: Record<string, unknown>) => ({
    code:
      typeof search.code === "string"
        ? search.code
        : typeof search.user_code === "string"
          ? search.user_code
          : undefined,
  }),
  component: DeviceVerifyPage,
})

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
})

const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: SessionDetailPage,
})

const assessmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assessments",
  component: AssessmentsPage,
})

const assessmentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assessments/$assessmentId",
  component: AssessmentDetailPage,
})

const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/billing",
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" ? search.status : undefined,
    tx_ref: typeof search.tx_ref === "string" ? search.tx_ref : undefined,
  }),
  component: BillingPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
})

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/design",
  component: DesignPage,
})

const childRoutes = [
  homeRoute,
  signUpRoute,
  signInRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  guardianApprovalRoute,
  deviceVerifyRoute,
  sessionsRoute,
  sessionDetailRoute,
  assessmentsRoute,
  assessmentDetailRoute,
  billingRoute,
  settingsRoute,
  ...(import.meta.env.DEV ? [designRoute] : []),
]

const routeTree = rootRoute.addChildren(childRoutes)

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
