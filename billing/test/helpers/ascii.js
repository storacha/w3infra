import { randomInteger } from './math.js'

const alphas = [...'abcdefghijklmnopqrstuvwxyz']
const alphaNumerics = [...alphas, ...'0123456789']

/** @param {number} size */
export const randomAlphas = size => {
  let word = ''
  for (let i = 0; i < size; i++) {
    word += alphas[randomInteger(0, alphas.length)]
  }
  return word
}

/** @param {number} size */
export const randomAlphaNumerics = size => {
  let word = ''
  for (let i = 0; i < size; i++) {
    word += alphaNumerics[randomInteger(0, alphaNumerics.length)]
  }
  return word
}
