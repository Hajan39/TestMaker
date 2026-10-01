/** The TestMaker logo: a sheet of paper with a correction tick. */
export function Mark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="TestMaker">
      <rect width="512" height="512" rx="112" fill="var(--color-brand)" />
      <rect x="128" y="92" width="256" height="328" rx="28" fill="#ffffff" />
      <rect x="170" y="150" width="172" height="22" rx="11" fill="#cfe6de" />
      <rect x="170" y="198" width="120" height="22" rx="11" fill="#cfe6de" />
      <path
        d="M176 288 L 218 330 L 310 232"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="36"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
