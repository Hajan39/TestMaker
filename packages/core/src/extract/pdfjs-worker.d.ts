/** pdf.js k modulu workeru typy nedodává; potřebujeme z něj jen to, že existuje. */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
