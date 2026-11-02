/** Shown in DIRECT_API_MODE=simulator, except on the screens of a simulated business, where the pult says it. */
export function TestModeBanner() {
  return (
    <div role="status" data-testid="test-mode-banner" className="test-banner">
      Тестовый стенд — Яндекс Директ не подключён, реклама не показывается
    </div>
  );
}
