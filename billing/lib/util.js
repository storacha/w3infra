export const startOfMonth = () => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCHours(0)
  d.setUTCMinutes(0)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  return d
}

export const startOfLastMonth = () => {
  const d = startOfMonth()
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d
}
