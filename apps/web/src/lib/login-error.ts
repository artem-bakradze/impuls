/**
 * Auth.js redirects to the start page with `?error=<type>`. Google is off for now, so there is no consent to decline:
 * every error, a direct request to the Google login included, gets one plain message.
 */
export const loginErrorMessage = (error: string | undefined): string | null =>
  error === undefined ? null : "Не получилось войти. Попробуйте ещё раз через минуту";
