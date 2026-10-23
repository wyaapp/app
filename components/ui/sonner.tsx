"use client"

import { CheckCircleIcon } from '@phosphor-icons/react/dist/ssr/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/dist/ssr/Info';
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/ssr/SpinnerGap';
import { WarningOctagonIcon } from '@phosphor-icons/react/dist/ssr/WarningOctagon';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr/Warning';
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon weight="regular" aria-hidden="true" className="size-4" />,
        info: <InfoIcon weight="regular" aria-hidden="true" className="size-4" />,
        warning: <WarningIcon weight="regular" aria-hidden="true" className="size-4" />,
        error: <WarningOctagonIcon weight="regular" aria-hidden="true" className="size-4" />,
        loading: <SpinnerGapIcon weight="regular" aria-hidden="true" className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
