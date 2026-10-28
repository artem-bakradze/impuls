/** Shown on every page while DIRECT_API_MODE is not production. */
export function TestModeBanner() {
  return (
    <div role="status" data-testid="test-mode-banner" className="test-banner">
      Тестовый режим — реклама не показывается
    </div>
  );
}
