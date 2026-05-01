export function NotificationButton() {
  return (
    <button
      type="button"
      aria-label="Notifications"
      className="hairline grid h-8 w-8 place-items-center rounded-full text-ink-400 transition-colors hover:text-ink-100"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10 20a2 2 0 0 0 4 0"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
