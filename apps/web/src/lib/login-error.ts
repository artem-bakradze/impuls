/** Auth.js redirects to the start page with `?error=<type>`; a declined Google consent arrives as OAuthCallbackError. */
export const loginErrorMessage = (error: string | undefined): string | null => {
  if (error === undefined) {
    return null;
  }
  if (error === "OAuthCallbackError" || error === "AccessDenied") {
    return "Вход отменён. Чтобы продолжить, войдите через Google ещё раз";
  }
  return "Не получилось войти. Попробуйте ещё раз через минуту";
};
