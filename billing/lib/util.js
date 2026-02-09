export const GB = 1024 * 1024 * 1024

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
