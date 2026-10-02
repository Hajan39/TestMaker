/** pdf.js ships no types for its worker module; we only need to know it exists. */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
