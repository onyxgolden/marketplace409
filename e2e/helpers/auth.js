// Sign-in helpers for the smoke suite. Auth runs through the real /auth UI
// (no token injection): a test that cannot sign in through the UI the way a
// tenant does has found a real defect, not a harness problem.
import { expect } from "@playwright/test";

export async function signIn(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/auth`);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  // The app redirects on session establishment (onAuthStateChange). If we
  // are still on /auth after the wait, sign-in genuinely failed — the caller
  // must not paper over it by navigating anyway.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20000 });
}

export async function signUp(page, baseUrl, email, password, _options = {}) {
  await page.goto(`${baseUrl}/auth`);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Create Account" }).click();
  // No redirect is expected: a fresh signup is unconfirmed until the
  // confirmation email is clicked, so no session is established. Wait for
  // the action to finish (button back to its idle label) instead of a blind
  // sleep, then callers assert the no-access state from here.
  await expect(page.getByRole("button", { name: "Create Account", exact: true })).toBeVisible({ timeout: 20000 });
}

// Signs in and returns a Playwright APIRequestContext sharing the browser
// context's cookies, for the API-level negative cases (403/404/409) that the
// UI cannot express (a cross-workspace tenant never renders for the owner).
export async function signedInRequest(page, baseUrl, email, password) {
  await signIn(page, baseUrl, email, password);
  return page.context().request;
}

export async function postRentalOperation(request, baseUrl, body) {
  const response = await request.post(`${baseUrl}/api/rental`, {
    headers: { "content-type": "application/json" },
    data: body,
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status(), body: parsed };
}
