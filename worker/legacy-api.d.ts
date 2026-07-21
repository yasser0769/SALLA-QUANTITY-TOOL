declare module "./legacy/*.cjs" {
  const handler: (request: unknown, response: unknown) => unknown;
  export default handler;
}
