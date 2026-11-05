// Values are read at use time so the server can start without them.
export const ENV = {
  get llmApiUrl() { return process.env.LLM_API_URL ?? ""; },
  get llmApiKey() { return process.env.LLM_API_KEY ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
