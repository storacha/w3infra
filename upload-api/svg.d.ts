// We load SVGs as strings
declare module '*.svg' {
  const svgString: string
  export default svgString
}
