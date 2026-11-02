"use client";

import { CheckCircleFilled, CheckOutlined, ClockCircleOutlined, ExperimentOutlined, MessageOutlined, RiseOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Input } from "antd";
import { Logo, LogoMark } from "./ui/Logo";

interface Props {
  errorText: string | null;
  testLogin: boolean;
  signInWithGoogle: () => Promise<void>;
  signInForTests: (formData: FormData) => Promise<void>;
}

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

/** What the owner gets every week — a static picture of the product, not real data. */
function ProductMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <LogoMark size={24} />
          <span className="t-h3">Неделя 14–20 октября</span>
        </div>
        <span className="chip chip-success">Работает</span>
      </div>
      <div className="mock-kpis">
        <div className="mock-kpi">
          <div className="t-small">Обращения</div>
          <div className="v t-num">27</div>
          <div className="t-small" style={{ color: "var(--success)" }}>
            ↑ 8 к прошлой
          </div>
        </div>
        <div className="mock-kpi">
          <div className="t-small">Цена обращения</div>
          <div className="v t-num">640 ₽</div>
          <div className="t-small" style={{ color: "var(--success)" }}>
            ↓ 150 ₽
          </div>
        </div>
        <div className="mock-kpi">
          <div className="t-small">Потрачено</div>
          <div className="v t-num">17 280 ₽</div>
          <div className="t-small">из 30 000 ₽</div>
        </div>
      </div>
      <svg viewBox="0 0 300 70" style={{ width: "100%", height: 70, margin: "14px 0 8px" }}>
        <defs>
          <linearGradient id="mock-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5646f2" stopOpacity="0.28" />
            <stop offset="1" stopColor="#5646f2" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 55 L43 48 L86 52 L129 36 L172 40 L215 24 L258 28 L300 12 L300 70 L0 70 Z" fill="url(#mock-area)" />
        <path d="M0 55 L43 48 L86 52 L129 36 L172 40 L215 24 L258 28 L300 12" fill="none" stroke="#5646f2" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
        <div className="mock-event">
          <span className="icon-tile accent" style={{ width: 28, height: 28, fontSize: 13 }}>
            <RiseOutlined />
          </span>
          <span>
            <b>Добавили 20% рекламе в поиске:</b> 6 обращений по 520 ₽ — дешевле остальной.
          </span>
        </div>
        <div className="mock-event">
          <span className="icon-tile warning" style={{ width: 28, height: 28, fontSize: 13 }}>
            <ThunderboltOutlined />
          </span>
          <span>
            <b>Отключили «Маникюр без записи»:</b> 2 600 ₽ за 14 дней и ни одного обращения.
          </span>
        </div>
      </div>
      <div className="mock-event mock-float">
        <CheckCircleFilled style={{ color: "var(--success)", fontSize: 18, marginTop: 1 }} />
        <span>
          Бюджет месяца под защитой: <b>больше 30 000 ₽ не потратим</b>
        </span>
      </div>
    </div>
  );
}

export function LoginCard({ errorText, testLogin, signInWithGoogle, signInForTests }: Props) {
  return (
    <main className="landing">
      <div className="container">
        <div className="landing-top">
          <Logo />
        </div>
        <div className="landing-grid">
          <div className="stack" style={{ "--gap": "28px" } as React.CSSProperties}>
            <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
              <span className="chip chip-accent chip-plain" style={{ alignSelf: "flex-start" }}>
                Реклама в Яндексе на автопилоте
              </span>
              <h1 className="t-display">Клиенты из Яндекса — без настройки рекламы</h1>
              <p className="t-lead" style={{ maxWidth: 520 }}>
                Расскажите о бизнесе и назовите бюджет. Импульс сам напишет объявления, запустит их и каждый день будет убирать то, что не приносит клиентов.
              </p>
            </div>
            <ul className="benefits">
              <li>
                <span className="benefit-icon">
                  <ClockCircleOutlined />
                </span>
                <span>
                  <b>10 минут до запуска.</b> Нужны только сайт и аккаунт в Яндекс Директе — без ставок и ключевых фраз.
                </span>
              </li>
              <li>
                <span className="benefit-icon">
                  <SafetyCertificateOutlined />
                </span>
                <span>
                  <b>Бюджет никогда не превышается.</b> Это проверяет код, а не обещание.
                </span>
              </li>
              <li>
                <span className="benefit-icon">
                  <MessageOutlined />
                </span>
                <span>
                  <b>Каждое изменение — простыми словами</b> и с кнопкой «Вернуть как было».
                </span>
              </li>
              <li>
                <span className="benefit-icon">
                  <ExperimentOutlined />
                </span>
                <span>
                  <b>Можно сначала посмотреть в симуляции:</b> месяц рекламы за 5 минут, без денег и без Директа — и видно, как сервис принимает решения.
                </span>
              </li>
            </ul>
            {errorText ? <Alert type="warning" showIcon title={errorText} /> : null}
            <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
              <form action={signInWithGoogle}>
                <button type="submit" className="google-btn">
                  <span className="g-mark">
                    <GoogleG />
                  </span>
                  Войти через Google
                </button>
              </form>
              <div className="trust">
                <span>
                  <CheckOutlined aria-hidden="true" />
                  Деньги на рекламу списываются только в вашем кабинете Яндекса
                </span>
                <span>
                  <CheckOutlined aria-hidden="true" />
                  Ваши собственные кампании в кабинете мы не трогаем
                </span>
              </div>
            </div>
            {testLogin ? (
              <form action={signInForTests} className="test-login" data-testid="test-login">
                <div className="t-small" style={{ marginBottom: 10 }}>
                  Тестовый вход — только для проверок, без Google
                </div>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <Input name="email" type="email" required placeholder="Почта" aria-label="Почта для тестового входа" style={{ flex: "1 1 180px" }} />
                  <Input name="name" required placeholder="Имя" aria-label="Имя для тестового входа" style={{ flex: "1 1 120px" }} />
                  <Button htmlType="submit">Войти для проверки</Button>
                </div>
              </form>
            ) : null}
          </div>
          <ProductMock />
        </div>
      </div>
    </main>
  );
}
