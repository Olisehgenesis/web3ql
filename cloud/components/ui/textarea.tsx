import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2',
        'text-[14px] text-gray-900 placeholder:text-gray-400',
        'shadow-sm transition-colors duration-150 resize-none',
        'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-0 focus:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export { Textarea }
