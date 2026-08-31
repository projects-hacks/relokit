/**
 * Where the reader is, or a clear refusal.
 *
 * The browser's own timeout only starts once permission is granted, so a prompt
 * left sitting resolves neither callback and the request hangs for as long as
 * the page is open. A question that waits forever is worse than one that gives
 * up and says why, so this keeps a clock of its own.
 */
export function locate(patience = 10_000): Promise<{ lat: number; lng: number }> {
  const asked = new Promise<{ lat: number; lng: number }>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('this browser cannot share a location'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      reject,
      { timeout: 8000, maximumAge: 300_000 },
    )
  })
  const givingUp = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('no answer to the location request')), patience),
  )
  return Promise.race([asked, givingUp])
}
