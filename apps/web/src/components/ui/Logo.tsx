/** «Импульс» mark: a heartbeat line in a rounded square — the service keeps the ads' pulse. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9.5" fill="var(--accent, #5a48f0)" />
      <path d="M6 17h5l2.5-6 4 11 2.5-7H26" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      Импульс
    </span>
  );
}
