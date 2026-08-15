export class FirstmateUiController {
  private open = false
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): boolean => this.open

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  show = (): void => this.setOpen(true)
  hide = (): void => this.setOpen(false)
  toggle = (): void => this.setOpen(!this.open)

  private setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    for (const listener of this.listeners) listener()
  }
}
