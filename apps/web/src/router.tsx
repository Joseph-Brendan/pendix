import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router"
import { DesignPage } from "./pages/DesignPage.js"
import { DeviceVerifyPage } from "./pages/DeviceVerifyPage.js"
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage.js"
import { GuardianApprovalPage } from "./pages/GuardianApprovalPage.js"
import { HomePage } from "./pages/HomePage.js"
import { SectionPlaceholderPage } from "./pages/SectionPlaceholderPage.js"
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
  component: () => (
    <SectionPlaceholderPage
      title="Sessions"
      description="Your graded coding sessions and prompt breakdowns will appear here."
    />
  ),
})

const assessmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assessments",
  component: () => (
    <SectionPlaceholderPage
      title="Assessments"
      description="Your weekly five-question checks appear here every Saturday morning."
    />
  ),
})

const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/billing",
  component: () => (
    <SectionPlaceholderPage
      title="Billing"
      description="Manage your plan, credit packs, and payment history here."
    />
  ),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => (
    <SectionPlaceholderPage
      title="Settings"
      description="Manage your connected devices, email preferences, and teach mode lock."
    />
  ),
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
  assessmentsRoute,
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
