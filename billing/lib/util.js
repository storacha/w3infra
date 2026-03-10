export const GB = 1024 * 1024 * 1024
/** 24 hours in milliseconds */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** @param {string|number|Date} now */                                                                                               
export const startOfToday = (now) => {                                                                                                 
  const d = new Date(now)                                                                                                            
  d.setUTCHours(0, 0, 0, 0)                                                                                                          
  return d                                                                                                                           
}                                                                                                                                    
                                                                                                                                      
/** @param {string|number|Date} now */                                                                                               
export const startOfYesterday = (now) => {                                                                                           
  const d = startOfToday(now)                                                                                                          
  d.setUTCDate(d.getUTCDate() - 1)                                                                                                   
  return d                                                                                                                           
}

/** @param {string|number|Date} now */
export const startOfMonth = (now) => {
  const d = new Date(now)
  d.setUTCDate(1)
  d.setUTCHours(0)
  d.setUTCMinutes(0)
  d.setUTCSeconds(0)
  d.setUTCMilliseconds(0)
  return d
}

/** @param {string|number|Date} now */
export const startOfLastMonth = (now) => {
  const d = startOfMonth(now)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d
}

/** @param {string|number|Date} date */
export const isMonthStart = (date) => {
  const d = new Date(date)
  return d.getUTCDate() === 1 &&
  d.getUTCHours() === 0 &&
  d.getUTCMinutes() === 0
}

/** @param {Date} d */
export const toDateString = (d) => d.toISOString().split('T')[0]

/**
 * Sleep for specified milliseconds to reduce DynamoDB read pressure.
 *
 * @private
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
