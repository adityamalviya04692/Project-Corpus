import { useId } from 'react';

/* The Corpus mark: a "C" made of the corpus, a lens at its centre (the question),
   and a point leaving through the opening (the cited answer). */
export default function Logo({ className = 'logo' }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14b88e" />
          <stop offset="0.55" stopColor="#0a7a5d" />
          <stop offset="1" stopColor="#3b2bb8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}g)`} />
      <path d="M21.6 10.3A8 8 0 1 0 21.6 21.7" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.7" fill="#b9a8ff" />
      <circle cx="25" cy="16" r="1.9" fill="#fff" />
    </svg>
  );
}
