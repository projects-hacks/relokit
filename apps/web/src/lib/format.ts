export function money(cents: number | null): string | null {
  return cents === null ? null : `$${Math.round(cents / 100).toLocaleString('en-US')}`
}

export function ago(atMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - atMs) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Named the way a person would say it, not the way the registry stores it. */
export function sourceName(source: string): string {
  const names: Record<string, string> = {
    zillow: 'Zillow',
    google_maps: 'Google Maps',
    google_maps_directions: 'Directions',
    google_local: 'Google',
    google_maps_reviews: 'Reviews',
    google_news: 'Google News',
    yelp: 'Yelp',
  }
  return names[source] ?? source
}
