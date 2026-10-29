/** «Импульс» mark: a heartbeat line in a rounded square — the service keeps the ads' pulse. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="impuls-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c6dff" />
          <stop offset="1" stopColor="#3a2cc4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#impuls-g)" />
      <path d="M6 17h5l2.5-6 4 11 2.5-7H26" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      Импульс
    </span>
  );
}
