import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppearance } from '@/theme/ThemeProvider';

/**
 * Minimal shadcn surface for theme QA. Open with `#/shadcn-smoke` in the renderer URL.
 */
export function ShadcnThemeSmoke() {
  const { preference, resolved, setPreference } = useAppearance();

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight">shadcn theme smoke</h1>
          <p className="text-sm text-muted-foreground">
            Resolved: <span className="font-medium text-foreground">{resolved}</span> ·
            Preference: <span className="font-medium text-foreground">{preference}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={preference === mode ? 'default' : 'outline'}
                onClick={() => void setPreference(mode)}
              >
                {mode}
              </Button>
            ))}
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Primitives</CardTitle>
            <CardDescription>Core tokens and Fluxx status colors.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge className="border-status-needs-input/30 bg-status-needs-input/15 text-status-needs-input-foreground">
                Needs input
              </Badge>
              <Badge className="border-status-validation/30 bg-status-validation/15 text-status-validation-foreground">
                Validation
              </Badge>
              <Badge className="border-status-review/30 bg-status-review/15 text-status-review-foreground">
                Review
              </Badge>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="smoke-input">Input</Label>
              <Input id="smoke-input" placeholder="Type here…" />
            </div>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            Status swatches use <code className="text-foreground">status-*</code> semantic tokens.
          </CardFooter>
        </Card>

        <Tabs defaultValue="surface">
          <TabsList>
            <TabsTrigger value="surface">Surface</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
          </TabsList>
          <TabsContent value="surface" className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            Card / popover surfaces use shadcn semantic colors.
          </TabsContent>
          <TabsContent
            value="terminal"
            className="rounded-lg border border-status-terminal/25 bg-status-terminal p-4 font-mono text-sm text-status-terminal-foreground"
          >
            Terminal chrome stays dark in both themes for TUI readability.
          </TabsContent>
        </Tabs>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Remove the <code className="text-foreground">#/shadcn-smoke</code> hash to return to the
          app.
        </p>
      </div>
    </div>
  );
}
