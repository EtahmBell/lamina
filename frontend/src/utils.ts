export function displayError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed. Please retry.'
}

export function formatTimestamp(value: string | null): string {
  if (!value) return 'Not yet'
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
