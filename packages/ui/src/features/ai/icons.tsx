// Chat-surface glyphs. Deliberately not in src/icons.tsx: that set is lucide at
// one size and stroke, and these are bespoke shapes tuned to the 12–16px chip
// and button sizes used here.

export const CubeIcon = (): JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.6l5.5 3.2v6.4L8 14.4l-5.5-3.2V4.8L8 1.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M2.6 4.9L8 8l5.4-3.1M8 8v6.2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

export const CheckIcon = (): JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ImageIcon = (): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5.7" cy="6.3" r="1.15" fill="currentColor" />
    <path d="M3.6 12.6l3.4-3.6 2.3 2.3 2-2.1 2.9 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

export const ArrowUpIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 13V3.5M4 7l4-3.8L12 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
