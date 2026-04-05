export async function register() {
  const { config } = await import('@dotenvx/dotenvx')
  config()
}
