/** Shown on every page in DIRECT_API_MODE=simulator. */
export function TestModeBanner() {
  return (
    <div role="status" data-testid="test-mode-banner" className="test-banner">
      Тестовый режим — реклама не показывается
    </div>
  );
}
