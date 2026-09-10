type Props = {
  readonly direction: 'row' | 'col'
  readonly onDrag: (deltaPx: number) => void
  readonly class?: string
}

export const SplitGutter = (props: Props) => {
  const start = (e: MouseEvent): void => {
    e.preventDefault()
    let last = props.direction === 'row' ? e.clientX : e.clientY

    const move = (ev: MouseEvent): void => {
      const now = props.direction === 'row' ? ev.clientX : ev.clientY
      props.onDrag(now - last)
      last = now
    }
    const stop = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  return (
    <div
      class="gutter"
      classList={{ row: props.direction === 'row', col: props.direction === 'col', [props.class ?? '']: props.class !== undefined }}
      data-testid={props.class ?? 'gutter'}
      onMouseDown={start}
    />
  )
}
