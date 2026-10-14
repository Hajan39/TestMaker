"use client"

import * as React from "react"
import { cn } from "../cn"
import { Label as LabelPrimitive } from "radix-ui"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  // The gap goes on the field directly below the label, not on the label:
  // a label in a row next to a checkbox or button must stay aligned.
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none [&+:is([data-slot=input],[data-slot=textarea],[data-slot=select-trigger])]:mt-1.5 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
