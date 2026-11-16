'use client'

import { useState, type ComponentProps } from 'react'
import { formatDecimal, parseDecimal } from '@testmaker/core/schema'
import { Input } from './ui/input'

/**
 * A number field that takes both a decimal comma and a dot.
 *
 * `type="number"` depends on the browser and keyboard: Safari (Mac, iPad)
 * reports „1,5“ as an empty value, so half points quietly became zero. This
 * is a text field with a numeric keyboard (`inputMode="decimal"`) that keeps
 * what is typed — a just-typed comma must not vanish — and reports the number
 * only once it is a number. The text is replaced only when the value changes
 * from outside.
 */
export function DecimalInput({
  value,
  onValueChange,
  min,
  max,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
}) {
  const [text, setText] = useState(() => formatDecimal(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (parseDecimal(text) !== value) setText(formatDecimal(value))
  }
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      aria-invalid={parseDecimal(text) === null ? true : props['aria-invalid']}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = parseDecimal(event.target.value)
        if (parsed === null) return
        const next = clamp(parsed)
        setSeen(next)
        onValueChange(next)
      }}
      // Leaving the field tidies it: an unfinished or out-of-range entry
      // shows the value that actually counts.
      onBlur={(event) => {
        setText(formatDecimal(value))
        props.onBlur?.(event)
      }}
    />
  )
}
