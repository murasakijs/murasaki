import { Button, type ButtonProps, cn, Progress } from '@murasakijs/ui'
import { useEffect } from 'react'
import { useUpdate } from './updater.js'

export interface UpdateButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {}

/**
 * A ready-to-drop-in auto-updater button, wired to `useUpdate()`. Checks for
 * an update on mount, then renders:
 *  - nothing while idle/checking/not-available/error,
 *  - "Update to vX" (click to download) once one is `available`,
 *  - a progress bar while `downloading`,
 *  - "Restart to update" (click to install + relaunch) once `ready`.
 *
 * Unstyled opinions live in `useUpdate()`; this component is the
 * React Aria-based, restyleable presentation layer — override via `className`
 * or fork it, same as any other component in `@murasakijs/ui`.
 */
export function UpdateButton({ className, ...props }: UpdateButtonProps) {
  const update = useUpdate()

  useEffect(() => {
    update.check()
  }, [])

  if (update.status === 'downloading') {
    const percent = Math.round((update.progress ?? 0) * 100)
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <Button disabled {...props}>
          Downloading… {percent}%
        </Button>
        <Progress value={percent} className="h-1" />
      </div>
    )
  }

  if (update.status === 'ready') {
    return (
      <Button className={className} onClick={() => update.install()} {...props}>
        Restart to update
      </Button>
    )
  }

  if (update.status === 'available') {
    return (
      <Button className={className} onClick={() => update.download()} {...props}>
        Update to v{update.latest}
      </Button>
    )
  }

  return null
}
