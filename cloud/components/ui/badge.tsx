import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors',
  {
    variants: {
      variant: {
        default:   'bg-violet-50 text-violet-700 ring-violet-200',
        secondary: 'bg-gray-100 text-gray-700 ring-gray-200',
        success:   'bg-green-50 text-green-700 ring-green-200',
        warning:   'bg-orange-50 text-orange-700 ring-orange-200',
        danger:    'bg-red-50 text-red-700 ring-red-200',
        outline:   'bg-transparent text-gray-600 ring-gray-300',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
