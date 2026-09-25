import { useToast } from "@/hooks/use-toast"
import { useSettings } from "@/lib/data"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()
  const { settings } = useSettings()
  // With in-app pop-ups turned off, only errors still show; alerts go out as system notifications.
  const visible = settings.inAppPopups === false ? toasts.filter((t) => t.variant === "destructive") : toasts

  return (
    <ToastProvider duration={2000}>
      {visible.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
