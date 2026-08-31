/**
 * The two maps somebody might already have open.
 *
 * Drawn rather than written, because a row of outbound links reads as a wall of
 * words and these two are recognised long before they are read. Simple marks in
 * each service's own colours, always beside their name, so nothing here passes
 * itself off as the service's own badge.
 */
export function MapMark({ of }: { of: 'google' | 'apple' }) {
  if (of === 'google') {
    return (
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
        <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z" fill="#34a853" />
        <path d="M12 2a7 7 0 0 0-6.1 3.6l5.2 4.2L19 6.2A7 7 0 0 0 12 2Z" fill="#4285f4" />
        <path d="M5.9 5.6A7 7 0 0 0 5 9c0 2 1.1 4.4 2.4 6.5l4-5.7Z" fill="#fbbc04" />
        <path d="M19 6.2 11.1 9.8l3.4 8.3C17 15 19 11.4 19 9a7 7 0 0 0-.1-1.2Z" fill="#ea4335" />
        <circle cx="12" cy="9" r="2.6" fill="#fff" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#f2f4f6" />
      <path d="M2 15.5 8.5 11l5 3 4.5-3.6V17a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5Z" fill="#5bc46a" />
      <path d="M14.6 2H17a5 5 0 0 1 5 5v3.2L15 15Z" fill="#67b6f5" />
      <path
        d="m10.6 8.6 2.2-4.2a1.4 1.4 0 0 1 2.5 0l4 7.7c.6 1.1-.2 2.4-1.4 2.4h-3Z"
        fill="#f05b4a"
      />
    </svg>
  )
}
