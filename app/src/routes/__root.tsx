import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import TopNavbar from '../components/TopNavbar'
import Footer from '../components/Footer'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Know Ball — Football Analytics' },
      {
        name: 'description',
        content:
          'Objective player ratings based on match statistics. Per-game ratings, peer comparisons, and data-driven player profiles.',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNavbar />
      <main className="flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <Footer />
    </div>
  )
}