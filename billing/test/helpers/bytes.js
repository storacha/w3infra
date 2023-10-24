/** @param {number} size */
export const randomBytes = size => {
  const bytes = new Uint8Array(size)
  while (size) {
    const chunk = new Uint8Array(Math.min(size, 65_536))
    crypto.getRandomValues(chunk)

    size -= bytes.length
    bytes.set(chunk, size)
  }
  return bytes
}