import type { ReactNode } from 'react'

export const metadata = { title: 'WebCraft CMS API', description: 'Local Payload CMS API for WebCraft' }
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
