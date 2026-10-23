import { SpinnerGapIcon } from '@phosphor-icons/react/dist/ssr/SpinnerGap';

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <SpinnerGapIcon weight="regular"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
