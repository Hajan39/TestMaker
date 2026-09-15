# Redesign rozhraní TestMakeru — prováděcí plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přestavět rozhraní TestMakeru na třísloupcovou knihovnu postavenou na shadcn/ui, s přepracovanou kontrolou konceptů a skládáním testu.

**Architecture:** Komponenty ze shadcn/ui se zkopírují do `packages/ui` a stanou se jediným zdrojem primitiv; dnešní tři vlastní primitiva zmizí. Vzhled řídí proměnné Tailwindu 4 v `packages/ui/src/styles.css`, dva důrazy zapínají třídy `surface-chrome` a `surface-content`. Aplikace dostane jednu skořápku `AppShell` a knihovna tři sloupce. Logika, kterou lze ověřit testem (fronta konceptů, osnova testu, hrubý náhled), se odděluje do čistých funkcí a komponent testovaných přes Testing Library.

**Tech Stack:** Next.js 16.3.5, React 19.2.8, Tailwind CSS 4, shadcn/ui (CLI v4, base `radix`, unified `radix-ui` 1.6.7), lucide-react 1.46.0, vitest 5 + @testing-library/react 16.

**Spec:** `docs/superpowers/specs/2026-09-14-redesign-rozhrani-design.md`

## Global Constraints

- Veškerý text rozhraní, komentáře v kódu i dokumentace jsou česky. Commity anglicky podle Conventional Commits.
- Commit message končí řádkem `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Barvy, poloměry a typografii berou komponenty výhradně z proměnných v `packages/ui/src/styles.css`. Žádné hexadecimální hodnoty v komponentách.
- Akcentní barva je jedna: `--color-brand` `#0d7355`. Jméno `accent` patří shadcn a znamená tiché podbarvení při najetí; naše zelená se s ním nesmí srazit. Žlutá `#fdefd6`/`#8a5a06` jen pro stav koncept, červená `#b03a35` jen pro mazání a zamítnutí.
- Poloměry: 5 px uvnitř, 8 px vnější plochy, 3 px štítky. Bez stínů.
- Body zlomu: tři sloupce nad 1280 px, dva mezi 1024 a 1280 px, jeden pod 1024 px.
- Datový model, API, generování ani vykreslení PDF se nemění. Jedinou výjimkou je úryvek zdroje u otázky (Task 8).
- Mimo rozsah: tmavý režim, telefon pod 768 px, editor šablon, přihlášení.
- Po každém úkolu musí projít `pnpm typecheck`, `pnpm test` a `pnpm build`.

---

### Task 1: Testovací zázemí pro komponenty

Bez běžícího testovacího prostředí v `packages/ui` nejde ověřit nic z toho, co přijde
potom. Tento úkol nepřidává žádnou funkci, jen zázemí a jeden test, který dokazuje,
že sestava funguje.

**Files:**
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/test/setup.ts`
- Create: `packages/ui/test/smoke.test.tsx`
- Modify: `packages/ui/package.json`

**Interfaces:**
- Consumes: nic
- Produces: skript `pnpm --filter @testmaker/ui test`; testy se píší do `packages/ui/test/*.test.tsx`, prostředí `jsdom`, k dispozici matchery z `@testing-library/jest-dom`.

- [ ] **Step 1: Přidat závislosti**

```bash
cd packages/ui
pnpm add -D vitest@^5.0.0 jsdom@^30.0.1 @testing-library/react@^16.3.3 \
  @testing-library/user-event@^14.6.7 @testing-library/jest-dom@^7.0.1 \
  @vitejs/plugin-react @types/react-dom
pnpm add react-dom@^19.2.8
```

- [ ] **Step 2: Doplnit skripty do `packages/ui/package.json`**

Do bloku `scripts` přidat:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Vytvořit `packages/ui/vitest.config.ts`**

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
})
```

- [ ] **Step 4: Vytvořit `packages/ui/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Každý test začíná s prázdným DOM.
afterEach(() => cleanup())
```

- [ ] **Step 5: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/smoke.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cn } from '../src/cn'

describe('testovací zázemí', () => {
  it('vykreslí komponentu do jsdom', () => {
    render(<p className={cn('a', 'b')}>Ahoj</p>)
    expect(screen.getByText('Ahoj')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test`
Expected: PASS, 1 test

- [ ] **Step 7: Zapojit balíček do kořenového `pnpm test`**

Ověřit, že `pnpm test` v kořeni spustí i `@testmaker/ui` (kořenový skript je `pnpm -r test`).

Run: `pnpm test`
Expected: projdou testy `@testmaker/core` i `@testmaker/ui`

- [ ] **Step 8: Commit**

```bash
git add packages/ui apps/web/package.json pnpm-lock.yaml
git commit -m "test: set up component testing for the ui package

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Design tokeny a dva důrazy

Spec žádá jednu sadu proměnných a dvě třídy, které nad svou oblastí přepíší důraz.
Komponenty pak o důrazu nevědí.

**Files:**
- Modify: `packages/ui/src/styles.css`
- Create: `packages/ui/test/tokens.test.tsx`

**Interfaces:**
- Consumes: nic
- Produces: proměnné `--color-surface`, `--color-surface-muted`, `--color-fg`, `--color-fg-soft`, `--color-fg-muted`, `--color-line`, `--color-line-soft`, `--color-brand`, `--color-brand-bg`, `--color-draft-bg`, `--color-draft-fg`, `--color-danger`, `--radius-inner`, `--radius-outer`, `--radius-tag`, `--label-weight`, `--label-track`; třídy `surface-chrome` a `surface-content`.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/tokens.test.tsx`:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8')

describe('design tokeny', () => {
  it('definují jednu akcentní barvu a stavové barvy', () => {
    expect(css).toContain('--color-brand: #0d7355')
    expect(css).toContain('--color-draft-bg: #fdefd6')
    expect(css).toContain('--color-danger: #b03a35')
  })

  it('definují poloměry podle specifikace', () => {
    expect(css).toContain('--radius-inner: 5px')
    expect(css).toContain('--radius-outer: 8px')
    expect(css).toContain('--radius-tag: 3px')
  })

  it('nepojmenují naši zelenou jako accent, to jméno patří shadcn', () => {
    const theme = css.slice(0, css.indexOf('.surface-chrome'))
    expect(theme).not.toMatch(/--color-accent:\s*#0d7355/)
  })

  it('mají dva důrazy jako třídy, ne jako druhou sadu tokenů', () => {
    expect(css).toContain('.surface-chrome')
    expect(css).toContain('.surface-content')
    // Důraz smí přepisovat jen text, popisky a poloměr, ne paletu.
    const chrome = css.slice(css.indexOf('.surface-chrome'))
    expect(chrome).not.toContain('--color-brand:')
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/ui test tokens`
Expected: FAIL, `--color-brand: #0d7355` v souboru není

- [ ] **Step 3: Přepsat `packages/ui/src/styles.css`**

```css
/* Design tokeny sdílené celou aplikací. Importuje se z globals.css webu. */
@theme {
  /* Plochy */
  --color-surface: #ffffff;
  --color-surface-muted: #fafafa;

  /* Text */
  --color-fg: #0c0e12;
  --color-fg-soft: #3a4150;
  --color-fg-muted: #8a919f;

  /* Linky */
  --color-line: #e0e2e7;
  --color-line-soft: #eceef1;

  /* Značková barva — jediná barva pro akce, výběr a správné odpovědi.
     Nejmenuje se accent, protože tak si shadcn říká o tiché podbarvení. */
  --color-brand: #0d7355;
  --color-brand-bg: #e4f2ed;
  --color-brand-fg: #ffffff;

  /* Stav koncept */
  --color-draft-bg: #fdefd6;
  --color-draft-fg: #8a5a06;

  /* Destruktivní akce */
  --color-danger: #b03a35;
  --color-danger-bg: #fbeceb;

  /* Tvary */
  --radius-inner: 5px;
  --radius-outer: 8px;
  --radius-tag: 3px;
}

:root {
  /* Výchozí důraz odpovídá obsahu. */
  --label-weight: 600;
  --label-track: 0.06em;
  --text-strong: var(--color-fg);
  --text-body: var(--color-fg-soft);
}

/*
 * Dva důrazy. Navigační plochy čtou ostřejší hodnoty, obsahové mírnější.
 * Komponenty samy o důrazu nevědí a sahají vždy po týchž proměnných.
 */
.surface-chrome {
  --label-weight: 700;
  --label-track: 0.08em;
  --text-strong: var(--color-fg);
  --text-body: var(--color-fg-soft);
}

.surface-content {
  --label-weight: 600;
  --label-track: 0.06em;
  --text-strong: var(--color-fg);
  --text-body: var(--color-fg-soft);
}

/* Popisek sekce — jediná definice pro celou aplikaci. */
.ui-label {
  font-size: 0.594rem;
  text-transform: uppercase;
  letter-spacing: var(--label-track);
  font-weight: var(--label-weight);
  color: var(--color-fg-muted);
}

/* Čísla v přehledech nesmějí poskakovat. */
.ui-numeric {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test tokens`
Expected: PASS

- [ ] **Step 5: Ověřit, že aplikace se pořád sestaví**

Run: `pnpm build`
Expected: build projde. Staré třídy `ink-*` a `brand-*` už neexistují, takže barvy v aplikaci budou dočasně rozbité — to je v pořádku, Task 4 je nahradí.

- [ ] **Step 6: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): replace palette with role-based design tokens

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: shadcn/ui v balíčku ui

**Files:**
- Create: `packages/ui/components.json`
- Create: `packages/ui/src/ui/*` (generuje CLI)
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json`
- Create: `packages/ui/test/button.test.tsx`

**Interfaces:**
- Consumes: tokeny z Tasku 2
- Produces: re-exporty z `@testmaker/ui`: `Button`, `Input`, `Textarea`, `Label`, `Badge`, `Card` (+ `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`), `Checkbox`, `Select` (+ `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`), `Dialog` (+ `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`), `DropdownMenu` (+ položky), `Tabs` (+ `TabsList`, `TabsTrigger`, `TabsContent`), `Tooltip` (+ `TooltipProvider`, `TooltipTrigger`, `TooltipContent`), `Separator`, `ScrollArea`, `Sheet` (+ `SheetTrigger`, `SheetContent`), `Collapsible` (+ `CollapsibleTrigger`, `CollapsibleContent`), `Progress`, `Skeleton`, `AlertDialog` (+ položky).

- [ ] **Step 1: Vytvořit `packages/ui/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/",
    "utils": "@/cn",
    "ui": "@/ui",
    "lib": "@/",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 2: Doplnit alias `@/` do `packages/ui/tsconfig.json`**

Do `compilerOptions` přidat:

```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

- [ ] **Step 3: Přidat komponenty**

```bash
cd packages/ui
pnpm dlx shadcn@latest add button input textarea label badge card checkbox select \
  dialog dropdown-menu tabs tooltip separator scroll-area sheet collapsible \
  progress skeleton alert-dialog --yes
pnpm add lucide-react@^1.46.0
```

Pokud CLI nabídne přepis `src/styles.css`, odmítnout — tokeny z Tasku 2 musí zůstat.
Ověřit po doběhnutí: `grep -c "color-brand" src/styles.css` musí vrátit alespoň 1.

- [ ] **Step 4: Propojit shadcn tokeny s našimi**

shadcn komponenty sahají po `--color-primary`, `--color-background` a podobně.
Na konec `packages/ui/src/styles.css` přidat most, aby existovala jedna pravda:

```css
/* Most k pojmenování, které používají komponenty ze shadcn. */
@theme {
  --color-background: var(--color-surface);
  --color-foreground: var(--color-fg);
  --color-card: var(--color-surface);
  --color-card-foreground: var(--color-fg);
  --color-popover: var(--color-surface);
  --color-popover-foreground: var(--color-fg);
  --color-primary: var(--color-brand);
  --color-primary-foreground: var(--color-brand-fg);
  --color-secondary: var(--color-surface-muted);
  --color-secondary-foreground: var(--color-fg);
  --color-muted: var(--color-surface-muted);
  --color-muted-foreground: var(--color-fg-muted);
  /* U shadcn je accent tiché podbarvení při najetí, ne značková barva. */
  --color-accent: var(--color-surface-muted);
  --color-accent-foreground: var(--color-fg);
  --color-destructive: var(--color-danger);
  --color-border: var(--color-line);
  --color-input: var(--color-line);
  --color-ring: var(--color-brand);
  --radius: var(--radius-inner);
}
```

- [ ] **Step 5: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../src'

describe('Button', () => {
  it('vykreslí popisek a zavolá obsluhu kliknutí', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Vygenerovat otázky</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Vygenerovat otázky' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('zakázané tlačítko nereaguje', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Uložit</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Uložit' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/ui test button`
Expected: FAIL, `Button` se z `../src` neexportuje (index zatím ukazuje na staré primitivum)

- [ ] **Step 7: Přepsat `packages/ui/src/index.ts`**

```ts
export { cn } from './cn'

export { Button, buttonVariants } from './ui/button'
export { Input } from './ui/input'
export { Textarea } from './ui/textarea'
export { Label } from './ui/label'
export { Badge, badgeVariants } from './ui/badge'
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card'
export { Checkbox } from './ui/checkbox'
export {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from './ui/select'
export {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog'
export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from './ui/dropdown-menu'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
export { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from './ui/tooltip'
export { Separator } from './ui/separator'
export { ScrollArea, ScrollBar } from './ui/scroll-area'
export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from './ui/sheet'
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible'
export { Progress } from './ui/progress'
export { Skeleton } from './ui/skeleton'
export {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from './ui/alert-dialog'

// Doménové komponenty přibudou v dalších úkolech.
export { QuestionPreview } from './QuestionPreview'
```

- [ ] **Step 8: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test button`
Expected: PASS, 2 testy

- [ ] **Step 9: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): adopt shadcn/ui as the component base

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Převést aplikaci na nové komponenty

Mechanická, ale rozsáhlá náhrada: 13 souborů, zhruba 350 volání. Dnešní `Button`,
`Field` a `Surface` po ní zmizí. Cílem je funkční rovnocennost, ne nový vzhled
obrazovek — ten přijde v dalších úkolech.

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: všech 13 souborů, které importují `@testmaker/ui` (seznam níže)
- Delete: `packages/ui/src/Button.tsx`, `packages/ui/src/Field.tsx`, `packages/ui/src/Surface.tsx`
- Create: `packages/ui/src/EmptyState.tsx`

**Interfaces:**
- Consumes: exporty z Tasku 3
- Produces: `EmptyState({ title, hint?, action? })` zůstává v nabídce `@testmaker/ui`; `Spinner` nahrazuje `Loader2` z `lucide-react` s třídou `animate-spin`.

Soubory k úpravě: `app/page.tsx`, `app/import/ImportClient.tsx`, `app/questions/page.tsx`,
`app/templates/page.tsx`, `app/tests/page.tsx`, `app/topics/[id]/TopicWorkspace.tsx`,
`components/BulkGenerate.tsx`, `components/GenerateDialog.tsx`, `components/PayloadFields.tsx`,
`components/QuestionEditor.tsx`, `components/TemplatePreview.tsx`, `components/TestBuilder.tsx`,
`components/TopicGroup.tsx`.

- [ ] **Step 1: Vytvořit `packages/ui/src/EmptyState.tsx`**

```tsx
import type { ReactNode } from 'react'

/** Prázdný stav: co tu chybí a co s tím. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-[var(--radius-outer)] border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}
```

Doplnit do `packages/ui/src/index.ts`: `export { EmptyState } from './EmptyState'`

- [ ] **Step 2: Napsat test prázdného stavu**

Vytvořit `packages/ui/test/empty-state.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../src'

describe('EmptyState', () => {
  it('ukáže nadpis, nápovědu i akci', () => {
    render(<EmptyState title="Žádné otázky" hint="Vygeneruj je z materiálů." action={<button>Generovat</button>} />)
    expect(screen.getByText('Žádné otázky')).toBeInTheDocument()
    expect(screen.getByText('Vygeneruj je z materiálů.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generovat' })).toBeInTheDocument()
  })

  it('bez nápovědy a akce vykreslí jen nadpis', () => {
    render(<EmptyState title="Prázdno" />)
    expect(screen.getByText('Prázdno')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
```

Run: `pnpm --filter @testmaker/ui test empty-state`
Expected: PASS

- [ ] **Step 3: Nahradit volání v aplikaci**

Postupovat po jednom souboru ze seznamu výše. Pravidla náhrady:

| Dnes | Nově |
| --- | --- |
| `<Button variant="primary">` | `<Button>` (výchozí varianta shadcn je akcentní) |
| `<Button variant="secondary">` | `<Button variant="outline">` |
| `<Button variant="ghost">` | `<Button variant="ghost">` |
| `<Button variant="danger">` | `<Button variant="destructive">` |
| `<Button size="sm">` | `<Button size="sm">` |
| `<Label>Text</Label>` nad polem | `<Label htmlFor="id">Text</Label>` + `id` na poli |
| `<Select>` s `<option>` | `<Select value onValueChange>` + `SelectTrigger`/`SelectContent`/`SelectItem` |
| `<Checkbox checked onChange>` | `<Checkbox checked onCheckedChange>` |
| `<Badge tone="brand">` | `<Badge>` |
| `<Badge tone="warn">` | `<Badge className="bg-draft-bg text-draft-fg">` |
| `<Badge tone="danger">` | `<Badge variant="destructive">` |
| `<Spinner />` | `<Loader2 className="size-4 animate-spin" />` |
| `text-ink-900` | `text-fg` |
| `text-ink-600` / `text-ink-700` | `text-fg-soft` |
| `text-ink-400` / `text-ink-500` | `text-fg-muted` |
| `border-ink-200` | `border-line` |
| `divide-ink-100` | `divide-line-soft` |
| `bg-ink-50` | `bg-surface-muted` |
| `text-brand-700` / `bg-brand-600` | `text-brand` / `bg-brand` |

Pozor u `Select`: shadcn hlásí změnu hodnoty přes `onValueChange(value: string)`,
ne přes `onChange(event)`. Prázdná hodnota není povolená — místo `value=""` použít
sentinel `"vse"` a v obsluze ho převést na `''`.

- [ ] **Step 4: Obalit aplikaci `TooltipProvider`**

V `apps/web/src/app/layout.tsx` obalit obsah `<body>`:

```tsx
import { TooltipProvider } from '@testmaker/ui'
// …
<body className="min-h-full antialiased">
  <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
</body>
```

- [ ] **Step 5: Smazat stará primitiva**

```bash
git rm packages/ui/src/Button.tsx packages/ui/src/Field.tsx packages/ui/src/Surface.tsx
```

- [ ] **Step 6: Ověřit, že nic nezůstalo viset**

```bash
grep -rn "ink-[0-9]\|brand-[0-9]\|variant=\"primary\"\|tone=" apps/web/src packages/ui/src || echo "čisté"
```

Expected: `čisté`

- [ ] **Step 7: Ověřit sestavení a testy**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: vše projde

- [ ] **Step 8: Projít aplikaci v prohlížeči**

```bash
pnpm dev
```

Otevřít `/`, `/import`, `/questions`, `/tests`, `/tests/new`, `/templates` a jedno téma.
Expected: stránky se vykreslí, tlačítka, pole a rozbalovací nabídky fungují.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(web): move every screen onto the shadcn components

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Skořápka aplikace

**Files:**
- Create: `packages/ui/src/AppShell.tsx`
- Create: `packages/ui/test/app-shell.test.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: komponenty z Tasku 3
- Produces: `AppShell({ nav, activeHref, children })`, kde `nav: { href: string; label: string }[]`. Vykreslí horní lištu se značkou a navigací (třída `surface-chrome`) a pod ní pracovní plochu (`surface-content`). Odkazy dostává jako `ReactNode` přes `renderLink`, aby balíček nezávisel na Next.js.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/app-shell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../src'

const nav = [
  { href: '/', label: 'Knihovna' },
  { href: '/tests', label: 'Testy' },
  { href: '/templates', label: 'Šablony' },
]

describe('AppShell', () => {
  it('vykreslí značku, navigaci a obsah', () => {
    render(
      <AppShell nav={nav} activeHref="/" renderLink={(item) => <a href={item.href}>{item.label}</a>}>
        <p>Obsah</p>
      </AppShell>,
    )
    expect(screen.getByText('TestMaker')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Testy' })).toBeInTheDocument()
    expect(screen.getByText('Obsah')).toBeInTheDocument()
  })

  it('označí aktivní položku pro čtečky obrazovky', () => {
    render(
      <AppShell nav={nav} activeHref="/tests" renderLink={(item) => <a href={item.href}>{item.label}</a>}>
        <p>Obsah</p>
      </AppShell>,
    )
    const active = screen.getByRole('link', { name: 'Testy' }).closest('[aria-current]')
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('lišta nese ostřejší důraz, plocha mírnější', () => {
    const { container } = render(
      <AppShell nav={nav} activeHref="/" renderLink={(item) => <a href={item.href}>{item.label}</a>}>
        <p>Obsah</p>
      </AppShell>,
    )
    expect(container.querySelector('header')).toHaveClass('surface-chrome')
    expect(container.querySelector('main')).toHaveClass('surface-content')
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/ui test app-shell`
Expected: FAIL, `AppShell` neexistuje

- [ ] **Step 3: Vytvořit `packages/ui/src/AppShell.tsx`**

```tsx
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface NavItem {
  href: string
  label: string
}

/**
 * Jediná skořápka aplikace: lišta se značkou a přepínačem oblastí, pod ní
 * pracovní plocha. Odkazy vykresluje volající, aby balíček nezávisel na routeru.
 */
export function AppShell({
  nav,
  activeHref,
  renderLink,
  children,
}: {
  nav: NavItem[]
  activeHref: string
  renderLink: (item: NavItem) => ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="surface-chrome flex shrink-0 items-center gap-6 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="text-sm font-bold tracking-tight text-fg">TestMaker</span>
        <nav className="flex items-center gap-1 text-sm">
          {nav.map((item) => {
            const active = item.href === activeHref
            return (
              <span
                key={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-[var(--radius-inner)] px-2.5 py-1',
                  active ? 'bg-brand-bg font-semibold text-brand' : 'text-fg-muted hover:text-fg',
                )}
              >
                {renderLink(item)}
              </span>
            )
          })}
        </nav>
      </header>
      <main className="surface-content min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
```

Doplnit export do `packages/ui/src/index.ts`.

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test app-shell`
Expected: PASS, 3 testy

- [ ] **Step 5: Zapojit skořápku do `apps/web/src/app/layout.tsx`**

Navigaci vykreslit přes `next/link`; aktivní položku určit v klientské komponentě
`apps/web/src/components/MainNav.tsx` pomocí `usePathname()`. Odstranit dosavadní
ruční hlavičku a obal `max-w-7xl`.

- [ ] **Step 6: Ověřit v prohlížeči**

Run: `pnpm dev`
Expected: lišta drží nahoře, obsah se roluje pod ní, aktivní položka je zvýrazněná

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): add the application shell

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Třísloupcová knihovna

**Files:**
- Create: `packages/ui/src/ThreePane.tsx`
- Create: `packages/ui/src/NavList.tsx`
- Create: `packages/ui/test/nav-list.test.tsx`
- Modify: `apps/web/src/lib/library.ts`
- Create: `apps/web/src/components/LibrarySidebar.tsx`
- Create: `apps/web/src/components/TopicList.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/topics/[id]/layout.tsx`

**Interfaces:**
- Consumes: `AppShell` z Tasku 5, `loadLibraryTree()` z `apps/web/src/lib/library.ts` (vrací `SubjectNode[]` s `grades[].topics[]`)
- Mění: `TopicNode` dostává pole `draftCount: number`
- Produces: `ThreePane({ first, second, children })` — první sloupec 240 px, druhý 280 px, oba `surface-chrome`, obsah `surface-content`; pod 1280 px se skryje druhý sloupec, pod 1024 px oba. `NavList({ items, activeId, renderItem })` s položkami `{ id, label, count?, flag? }`.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/nav-list.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NavList } from '../src'

const items = [
  { id: 't1', label: 'Dýchací soustava', count: 18 },
  { id: 't2', label: 'Trávicí soustava', count: 12, flag: true },
  { id: 't3', label: 'Oběhová soustava', count: 0 },
]

describe('NavList', () => {
  it('vypíše položky s počty', () => {
    render(<NavList items={items} activeId="t1" renderItem={(i) => <a href="#">{i.label}</a>} />)
    expect(screen.getByText('Dýchací soustava')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('označí aktivní položku', () => {
    render(<NavList items={items} activeId="t2" renderItem={(i) => <a href="#">{i.label}</a>} />)
    const active = screen.getByText('Trávicí soustava').closest('[aria-current]')
    expect(active).toHaveAttribute('aria-current', 'true')
  })

  it('u položky s příznakem ukáže, že čeká kontrola', () => {
    render(<NavList items={items} activeId="t1" renderItem={(i) => <a href="#">{i.label}</a>} />)
    expect(screen.getByLabelText('Čekají nezkontrolované koncepty')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/ui test nav-list`
Expected: FAIL, `NavList` neexistuje

- [ ] **Step 3: Vytvořit `packages/ui/src/NavList.tsx`**

```tsx
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface NavListItem {
  id: string
  label: string
  count?: number
  /** Téma má nezkontrolované koncepty. */
  flag?: boolean
}

/** Seznam v postranním panelu: položka, počet a tečka u nedodělků. */
export function NavList({
  items,
  activeId,
  renderItem,
}: {
  items: NavListItem[]
  activeId?: string
  renderItem: (item: NavListItem) => ReactNode
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <li
            key={item.id}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-[var(--radius-inner)] px-2 py-1 text-sm',
              active ? 'bg-brand-bg font-semibold text-brand' : 'text-fg-soft hover:bg-surface-muted',
            )}
          >
            {item.flag ? (
              <span
                aria-label="Čekají nezkontrolované koncepty"
                className="size-1.5 shrink-0 rounded-full bg-draft-fg"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{renderItem(item)}</span>
            {typeof item.count === 'number' ? (
              <span className={cn('ui-numeric text-xs', active ? 'text-brand/70' : 'text-fg-muted')}>
                {item.count}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test nav-list`
Expected: PASS, 3 testy

- [ ] **Step 5: Vytvořit `packages/ui/src/ThreePane.tsx`**

```tsx
import type { ReactNode } from 'react'

/**
 * Tři sloupce podle specifikace. Pod 1280 px odpadá druhý sloupec,
 * pod 1024 px oba — obsah pak zabírá celou šířku.
 */
export function ThreePane({
  first,
  second,
  children,
}: {
  first: ReactNode
  second: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0">
      <aside className="surface-chrome hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-surface-muted p-3 lg:block">
        {first}
      </aside>
      <aside className="surface-chrome hidden w-70 shrink-0 overflow-y-auto border-r border-line p-3 xl:block">
        {second}
      </aside>
      <section className="surface-content min-w-0 flex-1 overflow-y-auto p-5">{children}</section>
    </div>
  )
}
```

- [ ] **Step 6: Rozšířit `loadLibraryTree()` o příznak konceptů**

`TopicNode` už nese `questionCount` i `approvedCount`. Doplnit `draftCount`, aby šlo
v seznamu ukázat tečku u témat s nezkontrolovanými koncepty. V dotazu na počty otázek
(`apps/web/src/lib/library.ts`) přidat vedle `approved` ještě:

```ts
        draft: sql<number>`sum(case when ${questions.status} = 'draft' then 1 else 0 end)`,
```

a do sestavení `TopicNode` `draftCount: Number(stats?.draft ?? 0)`.

- [ ] **Step 7: Vytvořit `apps/web/src/components/LibrarySidebar.tsx`**

```tsx
import Link from 'next/link'
import { NavList } from '@testmaker/ui'
import type { SubjectNode } from '@/lib/library'

/** První sloupec: předměty jako popisky, ročníky jako položky. */
export function LibrarySidebar({
  tree,
  activeGradeId,
}: {
  tree: SubjectNode[]
  activeGradeId?: string
}) {
  return (
    <nav className="space-y-3">
      {tree.map((subject) => (
        <div key={subject.id}>
          <p className="ui-label mb-1 px-2">{subject.name}</p>
          <NavList
            activeId={activeGradeId}
            items={subject.grades.map((grade) => ({
              id: grade.id,
              label: grade.name || 'Bez ročníku',
              count: grade.topics.length,
              flag: grade.topics.some((topic) => topic.draftCount > 0),
            }))}
            renderItem={(item) => (
              <Link href={`/?grade=${item.id}`} className="block">
                {item.label}
              </Link>
            )}
          />
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 8: Vytvořit `apps/web/src/components/TopicList.tsx`**

```tsx
import Link from 'next/link'
import { NavList } from '@testmaker/ui'
import type { GradeNode } from '@/lib/library'

/** Druhý sloupec: témata zvoleného ročníku. */
export function TopicList({
  grade,
  activeTopicId,
}: {
  grade: GradeNode | null
  activeTopicId?: string
}) {
  if (!grade) {
    return <p className="px-2 text-sm text-fg-muted">Vyber ročník vlevo.</p>
  }
  return (
    <div>
      <p className="ui-label mb-1 px-2">
        {grade.name || 'Bez ročníku'} · {grade.topics.length} témat
      </p>
      <NavList
        activeId={activeTopicId}
        items={grade.topics.map((topic) => ({
          id: topic.id,
          label: topic.name,
          count: topic.questionCount,
          flag: topic.draftCount > 0,
        }))}
        renderItem={(item) => (
          <Link href={`/topics/${item.id}`} className="block">
            {item.label}
          </Link>
        )}
      />
    </div>
  )
}
```

- [ ] **Step 9: Přepsat `apps/web/src/app/page.tsx`**

Stránka čte `searchParams.grade`, načte strom a vykreslí `ThreePane`:

```tsx
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string }>
}) {
  const { grade: gradeId } = await searchParams
  const tree = await loadLibraryTree()
  const grade = tree.flatMap((s) => s.grades).find((g) => g.id === gradeId) ?? null

  return (
    <ThreePane
      first={<LibrarySidebar tree={tree} activeGradeId={gradeId} />}
      second={<TopicList grade={grade} />}
    >
      {grade ? <GradeOverview grade={grade} /> : <LibraryOverview tree={tree} />}
    </ThreePane>
  )
}
```

`LibraryOverview` ukáže souhrn knihovny a rozcestník ročníků, `GradeOverview`
dlaždice témat zvoleného ročníku s počty a tlačítkem na hromadné generování.
Obě jsou lokální komponenty v témže souboru.

- [ ] **Step 10: Vytvořit `apps/web/src/app/topics/[id]/layout.tsx`**

Obalí detail tématu týmž `ThreePane`, aby při přechodu na téma sloupce nezmizely.
Ročník se odvodí z tématu:

```tsx
export default async function TopicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tree = await loadLibraryTree()
  const grade = tree.flatMap((s) => s.grades).find((g) => g.topics.some((t) => t.id === id)) ?? null

  return (
    <ThreePane
      first={<LibrarySidebar tree={tree} activeGradeId={grade?.id} />}
      second={<TopicList grade={grade} activeTopicId={id} />}
    >
      {children}
    </ThreePane>
  )
}
```

Detail tématu (`page.tsx`) pak vykresluje jen obsah, bez vlastního rámu.

- [ ] **Step 11: Ověřit v prohlížeči na třech šířkách**

Run: `pnpm dev`
Expected: na 1440 px tři sloupce, na 1200 px dva, na 900 px jeden. Kliknutí na ročník
mění prostřední sloupec, kliknutí na téma mění obsah a sloupce zůstávají.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(web): three-column library navigation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Detail tématu

**Files:**
- Create: `packages/ui/src/StatRow.tsx`
- Create: `packages/ui/test/stat-row.test.tsx`
- Modify: `apps/web/src/app/topics/[id]/page.tsx`
- Modify: `apps/web/src/components/TopicGroup.tsx`
- Modify: `apps/web/src/components/GenerateDialog.tsx`

**Interfaces:**
- Consumes: `ThreePane` z Tasku 6
- Produces: `StatRow({ items })` s `items: { value: number | string; label: string; tone?: 'default' | 'draft' }[]`.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/stat-row.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatRow } from '../src'

describe('StatRow', () => {
  it('vypíše hodnotu i popisek', () => {
    render(<StatRow items={[{ value: 3, label: 'materiály' }, { value: 18, label: 'otázek' }]} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('materiály')).toBeInTheDocument()
  })

  it('čísla jsou tabulková, aby neposkakovala', () => {
    render(<StatRow items={[{ value: 120, label: 'otázek' }]} />)
    expect(screen.getByText('120')).toHaveClass('ui-numeric')
  })

  it('zvýrazní počet čekajících konceptů', () => {
    render(<StatRow items={[{ value: 6, label: 'ke schválení', tone: 'draft' }]} />)
    expect(screen.getByText('6')).toHaveClass('text-draft-fg')
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/ui test stat-row`
Expected: FAIL, `StatRow` neexistuje

- [ ] **Step 3: Vytvořit `packages/ui/src/StatRow.tsx`**

```tsx
import { cn } from './cn'

export interface Stat {
  value: number | string
  label: string
  tone?: 'default' | 'draft'
}

/** Řádek s počty pod nadpisem obrazovky. */
export function StatRow({ items }: { items: Stat[] }) {
  return (
    <dl className="flex gap-6 border-y border-line-soft py-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <dd
            className={cn(
              'ui-numeric text-[17px] font-bold tracking-tight',
              item.tone === 'draft' ? 'text-draft-fg' : 'text-fg',
            )}
          >
            {item.value}
          </dd>
          <dt className="text-[10.5px] text-fg-muted">{item.label}</dt>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test stat-row`
Expected: PASS, 3 testy

- [ ] **Step 5: Přestavět detail tématu**

`apps/web/src/app/topics/[id]/page.tsx` drží pořadí: drobečky, nadpis, `StatRow`
(materiály, otázky, ke schválení), hlavní akce, skupina materiálů, seznam otázek.
Dnešní karty nahradit `Card`; nadpis 19 px tučně s proložením `-0.025em`.

- [ ] **Step 6: Skrýt nastavení generování pod rozbalení**

V `GenerateDialog.tsx` obalit `GenerateSettingsForm` komponentou `Collapsible`
s tlačítkem „Nastavení generování". Výchozí stav zavřený. Průběh generování se
ukazuje vedle tlačítka, ne jako samostatný blok.

- [ ] **Step 7: Ověřit v prohlížeči**

Run: `pnpm dev`
Expected: detail tématu drží pořadí ze specifikace, nastavení je schované, generování
hlásí průběh u tlačítka

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): restyle the topic detail

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Úryvek zdroje u vygenerované otázky

Bez odkazu na materiál nejde ve frontě ověřit, jestli odpověď v podkladech opravdu
je. Tento úkol je jediný zásah mimo rozhraní.

**Files:**
- Modify: `packages/core/src/schema/question.ts`
- Modify: `packages/core/src/ai/prompt.ts`
- Modify: `packages/core/src/ai/generate.ts`
- Modify: `apps/web/src/db/schema.ts`
- Modify: `apps/web/src/lib/questions.ts`
- Modify: `apps/web/src/lib/generation.ts`
- Create: `apps/web/drizzle/0001_source_snippet.sql` (generuje drizzle-kit)
- Modify: `packages/core/test/ai.test.ts`

**Interfaces:**
- Consumes: `questionContentSchema` z Tasku 0 (stávající kód)
- Produces: pole `source?: { fileName: string; quote: string }` v `QuestionContent`; sloupce `source_file` a `source_quote` v tabulce `questions`; `toQuestion()` je mapuje na `question.source`.

Pozor na kolizi jmen: `Question` už má pole `source: 'ai' | 'manual'`. Nové pole se
proto jmenuje `evidence`, aby se obě nepletla.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Do `packages/core/test/ai.test.ts` přidat:

```ts
describe('doklad původu otázky', () => {
  it('schéma přijme název souboru a citaci', () => {
    const parsed = questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Kolik laloků má pravá plíce?', answer: 'tři' },
      evidence: { fileName: 'Dýchací soustava.odp', quote: 'Pravá plíce má tři laloky.' },
    })
    expect(parsed.evidence?.quote).toContain('tři laloky')
  })

  it('doklad je nepovinný', () => {
    const parsed = questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Otázka?', answer: 'odpověď' },
    })
    expect(parsed.evidence).toBeUndefined()
  })

  it('prompt si o doklad řekne', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('evidence')
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/core test ai`
Expected: FAIL, `evidence` schéma odmítne

- [ ] **Step 3: Doplnit schéma v `packages/core/src/schema/question.ts`**

Do `baseFields` přidat:

```ts
  /** Doklad původu: soubor a pasáž, o kterou se otázka opírá. */
  evidence: z
    .object({
      fileName: z.string().min(1),
      quote: z.string().min(10).max(400),
    })
    .optional(),
```

- [ ] **Step 4: Doplnit pokyn do promptu**

Do `buildSystemPrompt()` v `packages/core/src/ai/prompt.ts` přidat bod:

```
'10. Ke každé otázce vyplň evidence: název souboru ze záhlaví === … === a doslovnou větu z materiálu, o kterou se správná odpověď opírá.',
```

- [ ] **Step 5: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/core test ai`
Expected: PASS

- [ ] **Step 6: Přidat sloupce do databáze**

V `apps/web/src/db/schema.ts` do tabulky `questions`:

```ts
    /** Soubor, ze kterého otázka vznikla. */
    sourceFile: text('source_file'),
    /** Pasáž z materiálu, o kterou se správná odpověď opírá. */
    sourceQuote: text('source_quote'),
```

```bash
cd apps/web && pnpm exec drizzle-kit generate --name source_snippet
```

- [ ] **Step 7: Promítnout do mapování**

V `apps/web/src/lib/questions.ts` doplnit `toQuestion()` o
`evidence: row.sourceFile ? { fileName: row.sourceFile, quote: row.sourceQuote ?? '' } : undefined`
a `insertQuestions()` o zápis obou sloupců z `item.evidence`.

- [ ] **Step 8: Ověřit a commit**

Run: `pnpm typecheck && pnpm test && pnpm build`

```bash
git add -A
git commit -m "feat: record which passage a generated question came from

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Kontrola konceptů

**Files:**
- Create: `packages/ui/src/QuestionCard.tsx`
- Create: `packages/ui/src/ReviewQueue.tsx`
- Create: `packages/ui/test/review-queue.test.tsx`
- Create: `apps/web/src/components/ReviewPanel.tsx`
- Modify: `apps/web/src/app/topics/[id]/TopicWorkspace.tsx`

**Interfaces:**
- Consumes: `Question` z `@testmaker/core/schema`, `QuestionPreview`
- Produces: `ReviewQueue({ questions, onApprove, onReject, onEdit, onClose })`. Klávesy: `a` schválit, `e` upravit, `x` zamítnout, `ArrowRight` přeskočit, `Escape` zavřít. Po rozhodnutí se posune na další otázku; po poslední zavolá `onClose`.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Vytvořit `packages/ui/test/review-queue.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Question } from '@testmaker/core/schema'
import { ReviewQueue } from '../src'

const q = (id: string, prompt: string): Question => ({
  id,
  topicId: 't1',
  materialId: null,
  source: 'ai',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'short_answer',
  payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
  points: 1,
  difficulty: 2,
  blocks: [],
}) as Question

const questions = [q('q1', 'První otázka?'), q('q2', 'Druhá otázka?')]

describe('ReviewQueue', () => {
  it('ukáže první otázku a postup', () => {
    render(<ReviewQueue questions={questions} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('První otázka?')).toBeInTheDocument()
    expect(screen.getByText('1 z 2')).toBeInTheDocument()
  })

  it('klávesa A schválí a posune na další', async () => {
    const onApprove = vi.fn()
    render(<ReviewQueue questions={questions} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />)
    await userEvent.keyboard('a')
    expect(onApprove).toHaveBeenCalledWith('q1')
    expect(screen.getByText('Druhá otázka?')).toBeInTheDocument()
  })

  it('klávesa X zamítne', async () => {
    const onReject = vi.fn()
    render(<ReviewQueue questions={questions} onApprove={vi.fn()} onReject={onReject} onEdit={vi.fn()} onClose={vi.fn()} />)
    await userEvent.keyboard('x')
    expect(onReject).toHaveBeenCalledWith('q1')
  })

  it('po poslední otázce frontu zavře', async () => {
    const onClose = vi.fn()
    render(<ReviewQueue questions={[questions[0]!]} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('a')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape zavře frontu bez rozhodnutí', async () => {
    const onClose = vi.fn()
    const onApprove = vi.fn()
    render(<ReviewQueue questions={questions} onApprove={onApprove} onReject={vi.fn()} onEdit={vi.fn()} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('ukáže doklad původu, když ho otázka má', () => {
    const withEvidence = {
      ...questions[0]!,
      evidence: { fileName: 'Dýchací soustava.odp', quote: 'Pravá plíce má tři laloky.' },
    } as Question
    render(<ReviewQueue questions={[withEvidence]} onApprove={vi.fn()} onReject={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Pravá plíce má tři laloky/)).toBeInTheDocument()
    expect(screen.getByText(/Dýchací soustava.odp/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/ui test review-queue`
Expected: FAIL, `ReviewQueue` neexistuje

- [ ] **Step 3: Vytvořit `packages/ui/src/ReviewQueue.tsx`**

Klient („use client"). Drží index aktuální otázky ve stavu. `useEffect` navěsí
posluchač `keydown` na `document`, ignoruje stisky v polích (`event.target`
je `input`, `textarea` nebo prvek s `isContentEditable`). Po rozhodnutí volá
příslušnou obsluhu a zvýší index; když index dojede na konec, zavolá `onClose`.
Vykresluje: ukazatel postupu (`Progress`), `QuestionPreview` v plné šířce, pod ním
rámeček s dokladem původu, a řadu tlačítek Schválit / Upravit / Zamítnout /
Přeskočit s nápovědou kláves.

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/ui test review-queue`
Expected: PASS, 6 testů

- [ ] **Step 5: Zapojit do tématu**

`apps/web/src/components/ReviewPanel.tsx` drží seznam otázek s filtry a hromadnými
akcemi (dnešní chování z `TopicWorkspace`) a přidává tlačítko „Projít po jedné",
které otevře `ReviewQueue` v `Dialog` nad filtrovaným výběrem. Obsluhy volají
stávající `/api/questions` metodou `PUT` pro stav.

- [ ] **Step 6: Ověřit v prohlížeči**

Run: `pnpm dev`
Expected: v tématu s koncepty jde projít frontu klávesami, stav se po zavření
propíše do seznamu, filtr se ve frontě respektuje

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): review generated drafts one at a time

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Skládání testu

`TestBuilder.tsx` má 470 řádků a obsahuje banku, osnovu i nastavení. Rozpadne se
podle odpovědností a přibude hrubý náhled.

**Files:**
- Create: `apps/web/src/components/test-builder/types.ts`
- Create: `apps/web/src/components/test-builder/BankPanel.tsx`
- Create: `apps/web/src/components/test-builder/TestOutline.tsx`
- Create: `apps/web/src/components/test-builder/TestSettings.tsx`
- Create: `apps/web/src/components/test-builder/RoughPreview.tsx`
- Create: `packages/core/src/pdf/estimate.ts`
- Create: `packages/core/test/estimate.test.ts`
- Modify: `apps/web/src/components/TestBuilder.tsx`
- Modify: `packages/core/src/pdf/index.ts`

**Interfaces:**
- Consumes: `ResolvedTestItem`, `totalPoints` z `@testmaker/core/schema`
- Produces: `estimateHeight(item: ResolvedTestItem, config: TemplateConfig): number` vrací odhad výšky položky v bodech; `paginate(items, config): ResolvedTestItem[][]` rozdělí položky na stránky. `RoughPreview({ items, template, graded })` z nich vykreslí náhled v prohlížeči.

- [ ] **Step 1: Napsat test, který zatím neprojde**

Vytvořit `packages/core/test/estimate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { estimateHeight, paginate } from '../src/pdf/estimate'
import { makeItems, makeTemplate } from './fixtures'

const template = makeTemplate()

describe('estimateHeight', () => {
  it('volná odpověď zabere víc než výběr z možností', () => {
    const items = makeItems()
    const open = items.find((i) => i.question?.type === 'open')!
    const choice = items.find((i) => i.question?.type === 'single_choice')!
    expect(estimateHeight(open, template.config)).toBeGreaterThan(
      estimateHeight(choice, template.config),
    )
  })

  it('zalomení strany nemá výšku', () => {
    const brk = { id: 'b', testId: 't', order: 0, kind: 'page_break' as const, questionId: null, text: null, pointsOverride: null }
    expect(estimateHeight(brk, template.config)).toBe(0)
  })
})

describe('paginate', () => {
  it('krátký test se vejde na jednu stranu', () => {
    expect(paginate(makeItems().slice(0, 3), template.config)).toHaveLength(1)
  })

  it('zalomení strany začne novou stranu', () => {
    const items = makeItems().slice(0, 3)
    const brk = { id: 'b', testId: 't', order: 99, kind: 'page_break' as const, questionId: null, text: null, pointsOverride: null }
    const pages = paginate([...items, brk, ...items], template.config)
    expect(pages.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `pnpm --filter @testmaker/core test estimate`
Expected: FAIL, modul `estimate` neexistuje

- [ ] **Step 3: Vytvořit `packages/core/src/pdf/estimate.ts`**

Odhad výšky podle typu otázky: základ za zadání, plus počet linek krát
`answerLineHeight` u `open`, plus počet možností krát řádek u výběrových,
plus řádky tabulky u `true_false` a `table_fill`. Nadpis a pokyn mají pevnou
výšku, zalomení nulovou. `paginate` sčítá výšky a zalomí, když součet překročí
využitelnou výšku A4 (842 bodů minus okraje z `config.page`).

Exportovat z `packages/core/src/pdf/index.ts`.

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `pnpm --filter @testmaker/core test estimate`
Expected: PASS, 4 testy

- [ ] **Step 5: Rozpad `TestBuilder.tsx`**

Stav zůstává v `TestBuilder`, sloupce jsou řízené komponenty. Rozhraní mezi nimi:

```tsx
// apps/web/src/components/test-builder/types.ts
import type { Question, ResolvedTestItem } from '@testmaker/core/schema'

/** Položka rozpracovaného testu; `key` je stabilní jen v paměti prohlížeče. */
export interface DraftItem {
  key: string
  kind: ResolvedTestItem['kind']
  questionId: string | null
  text: string | null
  pointsOverride: number | null
  question: Question | null
}

export interface BankFilters {
  search: string
  subject: string
  grade: string
  type: string
  onlyApproved: boolean
}
```

Podpisy sloupců:

```tsx
export function BankPanel(props: {
  topics: PickerTopic[]
  filters: BankFilters
  onFiltersChange: (next: BankFilters) => void
  usedIds: Set<string>
  onToggle: (question: Question) => void
}): React.JSX.Element

export function TestOutline(props: {
  items: DraftItem[]
  graded: boolean
  onReorder: (from: number, to: number) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
  onAdd: (kind: 'heading' | 'instruction' | 'page_break') => void
}): React.JSX.Element

export function RoughPreview(props: {
  items: DraftItem[]
  template: Template
  graded: boolean
  title: string
}): React.JSX.Element

export function TestSettings(props: {
  value: TestSettingsValue
  templates: Template[]
  onChange: (next: TestSettingsValue) => void
}): React.JSX.Element
```

Poznámky k provedení:

- `BankPanel` nahrazuje dnešní tlačítko Přidat zaškrtávátkem: `onToggle` otázku
  přidá, nebo vyjme, podle `usedIds`.
- `TestOutline` používá `@dnd-kit/sortable` (už je v závislostech). `onReorder`
  dostává indexy, ne klíče, aby šlo pořadí měnit i klávesnicí.
- `RoughPreview` volá `paginate(items, template.config)` z Tasku 10 a každou stranu
  vykreslí jako obdélník s poměrem `aspect-[210/297]`, texty otázek zkrácené na
  dva řádky a linkami místo odpovědí. Nevolá server.
- `TestSettings` se otevírá v `Sheet` z lišty, ne jako blok nad obsahem.

- [ ] **Step 6: Ověřit na třech šířkách**

Run: `pnpm dev`
Expected: na 1440 px tři sloupce; na 1200 px zmizí náhled; na 900 px jeden sloupec
se záložkami Banka / Osnova. Přetahování mění pořadí, souhrn sedí.

- [ ] **Step 7: Ověřit, že PDF zůstalo beze změny**

Poskládat test ze čtyř otázek, stáhnout PDF a porovnat s výstupem před redesignem.
Expected: shodné rozvržení stránky

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): rebuild the test builder around a live outline

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Zbylé stránky do nového rámu

**Files:**
- Modify: `apps/web/src/app/import/page.tsx`, `apps/web/src/app/import/ImportClient.tsx`
- Modify: `apps/web/src/app/questions/page.tsx`
- Modify: `apps/web/src/app/tests/page.tsx`
- Modify: `apps/web/src/app/templates/page.tsx`
- Modify: `apps/web/src/components/BulkGenerate.tsx`

**Interfaces:**
- Consumes: `AppShell`, `StatRow`, `EmptyState`, `QuestionCard`
- Produces: nic nového

- [ ] **Step 1: Import materiálů**

Průběh přepsat na `Progress`, přeskočené a chybné soubory na `Collapsible`.
Tlačítko výběru složky zvýraznit jako hlavní akci obrazovky.

- [ ] **Step 2: Banka otázek**

Seznam témat s ukázkou otázek nahradit tabulkou s filtry přes celou knihovnu.
Prázdný stav přes `EmptyState`.

- [ ] **Step 3: Testy**

Seznam testů jako tabulka: název, počet otázek, body, šablona, změněno, akce
v `DropdownMenu`. Mazání přes `AlertDialog`.

- [ ] **Step 4: Šablony**

Jen nový rám kolem stávajících náhledů, obsah beze změny.

- [ ] **Step 5: Hromadné generování**

Přesunout z přehledu do `Sheet` otevíraného z lišty ročníku, aby rozcestník
nezabíralo nastavení.

- [ ] **Step 6: Ověřit**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm dev`
Expected: všech osm obrazovek drží jeden vzhled

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): bring the remaining screens into the new shell

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Úklid a dokumentace

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Delete: zbytky nepoužitých souborů

- [ ] **Step 1: Najít mrtvý kód**

```bash
grep -rn "GenerateDialog\|Spinner\|tone=" apps/web/src packages/ui/src || echo "čisté"
```

Smazat, co už nikdo nevolá.

- [ ] **Step 2: Doplnit `CLAUDE.md`**

Přidat oddíl o design systému: tokeny žijí v `packages/ui/src/styles.css`, komponenty
pocházejí ze shadcn a jsou naším kódem, důraz se řídí třídami `surface-chrome` a
`surface-content`, nové barvy se nepřidávají.

- [ ] **Step 3: Doplnit `CHANGELOG.md`**

Do `[Nevydáno]` přidat oddíl **Změněno** s redesignem rozhraní a oddíl **Přidáno**
s frontou kontroly konceptů a dokladem původu otázky.

- [ ] **Step 4: Aktualizovat `README.md`**

Do výčtu schopností doplnit třísloupcovou knihovnu, kontrolu konceptů po jedné
otázce a náhled testu při skládání.

- [ ] **Step 5: Ověřit celek**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: vše projde

- [ ] **Step 6: Projít aplikaci klávesnicí**

Otevřít každou obrazovku a projít ji tabulátorem.
Expected: ohnisko je vidět, dialogy zavírá Escape, fronta konceptů jde ovládat bez myši

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: describe the design system and record the redesign

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
