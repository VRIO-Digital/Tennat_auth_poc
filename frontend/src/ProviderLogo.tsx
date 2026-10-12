// Simplified brand marks for each identity provider
export default function ProviderLogo({ id, size = 28 }: { id: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true } as const

  switch (id) {
    case 'azure_ad': // Microsoft
      return (
        <svg {...common}>
          <rect x="3" y="3" width="12.5" height="12.5" fill="#f25022" />
          <rect x="16.5" y="3" width="12.5" height="12.5" fill="#7fba00" />
          <rect x="3" y="16.5" width="12.5" height="12.5" fill="#00a4ef" />
          <rect x="16.5" y="16.5" width="12.5" height="12.5" fill="#ffb900" />
        </svg>
      )
    case 'okta':
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="9" fill="none" stroke="#007dc1" strokeWidth="6" />
        </svg>
      )
    case 'google_workspace': // Google "G"
      return (
        <svg {...common} fill="none" strokeWidth="5">
          <path d="M26 9.5A11 11 0 0 0 16 5" stroke="#ea4335" />
          <path d="M16 5A11 11 0 0 0 5.5 14" stroke="#ea4335" />
          <path d="M5.5 14A11 11 0 0 0 9 24" stroke="#fbbc05" />
          <path d="M9 24a11 11 0 0 0 13.5 1.5" stroke="#34a853" />
          <path d="M22.5 25.5A11 11 0 0 0 27 16h-11" stroke="#4285f4" />
        </svg>
      )
    case 'onelogin':
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="13" fill="#1c1f2a" />
          <path d="M13 11.5l4-2.5v14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'auth0':
      return (
        <svg {...common}>
          <path d="M16 3l11 4v9c0 6.5-4.6 10.8-11 13C9.6 26.800 5 22.500 5 16V7z" fill="#eb5424" />
          <path d="M16 10l1.800 5.500H23.500l-4.600 3.400 1.800 5.500L16 20.800l-4.700 3.600 1.800-5.500-4.600-3.400h5.700z" fill="#fff" />
        </svg>
      )
    default: // generic SAML: shield with key
      return (
        <svg {...common} fill="none" stroke="#475569" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3l11 4v9c0 6.500-4.600 10.800-11 13C9.600 26.800 5 22.500 5 16V7z" />
          <circle cx="16" cy="14" r="2.500" />
          <path d="M16 16.500V22M16 20h2.500" />
        </svg>
      )
  }
}
