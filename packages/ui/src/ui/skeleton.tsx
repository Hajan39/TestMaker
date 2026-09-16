import { cn } from "../cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Barva jde z vlastního tokenu, ne z `accent`: kostra se kreslí i do
      // postranních sloupců, které `accent` (tiché podbarvení) samy mají.
      className={cn("animate-pulse rounded-md bg-skeleton", className)}
      {...props}
    />
  )
}

export { Skeleton }
