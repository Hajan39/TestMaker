import { cn } from "../cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // The colour comes from its own token, not `accent`: skeletons are drawn
      // in sidebars too, which themselves use `accent` (the quiet tint).
      className={cn("animate-pulse rounded-md bg-skeleton", className)}
      {...props}
    />
  )
}

export { Skeleton }
