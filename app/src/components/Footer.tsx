import { Shield } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 py-4 md:px-8">
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/15">
            <Shield className="h-3 w-3 text-primary" />
          </div>
          <span className="text-sm text-muted-foreground">
            Know Ball — Data-driven football analytics
          </span>
        </div>
      </div>
    </footer>
  )
}