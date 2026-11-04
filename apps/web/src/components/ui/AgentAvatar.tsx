"use client";

import { useId } from "react";

/**
 * The assistant who speaks the service's reviews: a small friendly robot in a circle of the brand colour, not the logo
 * (simulation-mode spec «Симуляция как отдельный режим»). Decorative: the name next to it says who it is.
 */
export function AgentAvatar({ size = 40 }: { size?: number }) {
  // One gradient per avatar: the history shows many of them on one page.
  const id = `agent-bg-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="agent-avatar" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8b7dff" />
          <stop offset="1" stopColor="#4434df" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${id})`} />
      <line x1="20" y1="9.4" x2="20" y2="12.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="20" cy="8.2" r="2" fill="#ffd166" />
      <rect x="7.4" y="17.6" width="2.6" height="6" rx="1.3" fill="#fff" opacity="0.85" />
      <rect x="30" y="17.6" width="2.6" height="6" rx="1.3" fill="#fff" opacity="0.85" />
      <rect x="9.6" y="12.4" width="20.8" height="17.6" rx="6.4" fill="#fff" />
      <rect x="12.2" y="15" width="15.6" height="12.2" rx="4.6" fill="#2a2170" />
      <circle className="agent-eye" cx="16.6" cy="19.9" r="1.8" fill="#7ef0d0" />
      <circle className="agent-eye" cx="23.4" cy="19.9" r="1.8" fill="#7ef0d0" />
      <path d="M16.6 23.4q3.4 2.3 6.8 0" stroke="#7ef0d0" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
