import { Show } from 'solid-js'
import { type FileIconSpec, fileIconFor } from './iconSpec'

export const FolderIcon = (props: { open: boolean }) => (
  <svg class="tree-icon dir" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <Show
      when={props.open}
      fallback={<path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2a1.5 1.5 0 0 1 1.06.44L8.3 3H13a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3z" />}
    >
      <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.2a1.5 1.5 0 0 1 1.06.44L8.3 3H13a1.5 1.5 0 0 1 1.5 1.5V6H3.6a1.5 1.5 0 0 0-1.43 1.04L1.5 9.2V3zm.3 10.3L3.3 7.7A.5.5 0 0 1 3.78 7.4H14.6a.5.5 0 0 1 .48.65l-1.6 5.4a.75.75 0 0 1-.72.55H2.5a.7.7 0 0 1-.7-.7z" />
    </Show>
  </svg>
)

const GenericFile = () => (
  <svg class="tree-icon file" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
    <path d="M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
    <path d="M9.5 1.5V5H13" />
    <path d="M5.5 8h5M5.5 10.5h5" stroke-linecap="round" />
  </svg>
)

const ImageFile = () => (
  <svg class="tree-icon file image" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
    <circle cx="5.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" stroke-linejoin="round" />
  </svg>
)

export const FileIcon = (props: { name: string }) => {
  const spec = () => fileIconFor(props.name)
  return (
    <Show when={spec().kind === 'badge' ? spec() : null} fallback={spec().kind === 'image' ? <ImageFile /> : <GenericFile />}>
      {(b) => {
        const badge = b() as Extract<FileIconSpec, { kind: 'badge' }>
        return (
          <span class="tree-icon tree-badge" classList={{ long: badge.label.length > 2 }} style={{ background: badge.color }} data-badge={badge.label}>
            {badge.label}
          </span>
        )
      }}
    </Show>
  )
}
