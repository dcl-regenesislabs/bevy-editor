// The tree's disclosure caret. Its own module so a row that lives outside
// HierarchyPanel can use it without importing the panel back into itself.
export function TreeCaret(): JSX.Element {
  return (
    <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
