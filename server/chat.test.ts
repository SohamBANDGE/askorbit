import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

const caller = appRouter.createCaller({});

describe("chat.respond", () => {
  it("rejects a conversation that does not end with a user message", async () => {
    await expect(
      caller.chat.respond({ messages: [{ role: "assistant", content: "Hello" }] })
    ).rejects.toThrow("Add a question before sending.");
  });

  it("rejects an empty conversation", async () => {
    await expect(caller.chat.respond({ messages: [] })).rejects.toThrow();
  });
});
