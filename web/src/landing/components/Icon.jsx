const PATHS = {
  pay: <><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M3 10.5h18M7 14.5h3" /></>,
  fix: <path d="M12 3.5c3.2 4.1 6 7.2 6 10.3a6 6 0 0 1-12 0c0-3.1 2.8-6.2 6-10.3Z" />,
  visitor: <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.9-3.8 3.7-5.8 7-5.8s6.1 2 7 5.8" /></>,
  book: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></>,
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  down: <path d="M12 5v14m-5-5 5 5 5-5" />,
  wifiOff: <><path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4-2.4M19 12.6a10 10 0 0 0-3.2-2.1M2 9a15 15 0 0 1 4.6-2.9M22 9a15 15 0 0 0-9-3.4" /><circle cx="12" cy="20" r=".8" /></>,
  star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8Z" />,
};

export default function Icon({ name, size = '1em', className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>
  );
}
