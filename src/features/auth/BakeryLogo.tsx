/** شعار الخبز — SVG خفيف (بدل صور خارجية) */
export function BakeryLogo({ className = 'size-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#b45309" />
      <path
        d="M14 40c0-8.837 8.059-16 18-16s18 7.163 18 16c0 2.21-1.79 4-4 4H18c-2.21 0-4-1.79-4-4Z"
        fill="#fef3c7"
      />
      <path d="M25 32c1.5-2 4-3.5 7-3.5s5.5 1.5 7 3.5" stroke="#b45309" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M20 38.5c2-2.2 5.5-3.6 12-3.6s10 1.4 12 3.6" stroke="#d97706" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="18" r="2.4" fill="#fbbf24" />
      <path d="M32 15.6v-3M28.8 17l-2-2.2M35.2 17l2-2.2" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
