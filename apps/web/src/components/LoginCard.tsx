"use client";

import { ArrowRightOutlined } from "@ant-design/icons";
import { Alert, Button, Tooltip } from "antd";
import { useId } from "react";
import { Logo } from "./ui/Logo";

interface Props {
  errorText: string | null;
  signInAsDemo: () => Promise<void>;
}

/** Why the Google button does nothing (auth spec «Вход через Google пока недоступен»). */
export const GOOGLE_UNAVAILABLE = "Вход через Google пока недоступен — попробуйте демо-режим";

/** Google's multicolour «G», required on «Sign in with Google» buttons by Google's branding guidelines. */
function GoogleG() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * The start page (product-demo spec «Условия демосервиса»): one card on the calm canvas of «Реклама» — the logo, a
 * title, one line, «Демо-режим», the Google button that is unavailable for now and the demo's terms. Nothing else: the
 * stands' test login has no form here, e2e signs in through the Auth.js endpoint.
 */
export function LoginCard({ errorText, signInAsDemo }: Props) {
  const hintId = useId();
  return (
    <main className="login">
      <section className="login-card surface" aria-labelledby="login-title" data-testid="login-card">
        <Logo size={32} />
        <div className="login-head">
          {/* A no-break space keeps the dash at the end of the first line. */}
          <h1 id="login-title" className="login-title">
            Реклама в Яндексе{" "}— без настройки
          </h1>
          <p className="t-lead">Сервис сам пишет объявления и ведёт рекламу по вашему бюджету.</p>
        </div>
        {errorText ? <Alert type="warning" showIcon title={errorText} /> : null}
        <div className="login-actions">
          <form action={signInAsDemo}>
            <Button type="primary" htmlType="submit" size="large" block icon={<ArrowRightOutlined aria-hidden="true" />} iconPlacement="end">
              Демо-режим
            </Button>
          </form>
          {/* Focusable, so the hint is reached from the keyboard too; it starts nothing. */}
          <Tooltip title={GOOGLE_UNAVAILABLE} trigger={["hover", "focus"]}>
            <button type="button" className="google-btn" aria-disabled="true" aria-describedby={hintId} onClick={(event) => event.preventDefault()}>
              <GoogleG />
              Войти через Google
            </button>
          </Tooltip>
          <span id={hintId} className="sr-only">
            {GOOGLE_UNAVAILABLE}
          </span>
        </div>
        <p className="t-small login-terms">Демосервис без оплаты · деньги не списываются</p>
      </section>
    </main>
  );
}
