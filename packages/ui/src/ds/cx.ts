// The one class-list builder. An omitted variant drops out instead of leaving a
// doubled space behind — `class="eui-modal  eui-value-modal"` is what a template
// literal produces, and it makes an exact-className assertion brittle.
export function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
