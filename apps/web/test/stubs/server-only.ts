/**
 * Náhrada za balíček `server-only` v testech. Ten existuje jen proto, aby
 * bundler Next.js zakázal import serverového modulu do prohlížeče; mimo
 * bundler se načíst nedá, a tak ho vitest nahrazuje tímhle prázdným modulem.
 */
export {}
