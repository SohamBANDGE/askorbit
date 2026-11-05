import { z } from "zod";
import { invokeLLM, type Message } from "./_core/llm";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";

const chatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(6000),
}).strict();

const askOrbitInstructions = `You are AskOrbit, a thoughtful and approachable general-purpose assistant. Answer questions across a wide range of subjects, explain unfamiliar ideas clearly, and adapt the detail and tone to what the user needs. Use the conversation history to understand follow-ups and preserve context. Be accurate and candid: say when you are uncertain, do not invent facts or citations, and do not claim to have browsed or checked live information. For fast-changing or high-stakes topics, make limitations clear and encourage checking a current, authoritative source. Use clean Markdown when it helps (headings, lists, links, and fenced code). Keep straightforward answers concise and give more depth when the question calls for it.

Document and PDF requests: AskOrbit has a built-in “Save as PDF” control beneath every assistant answer. When a user asks you to create, write, or make a PDF, do not say you cannot generate or download files, and do not suggest printing the page or using another editor instead. Write the requested document itself in your answer with a clear title and useful structure (headings, paragraphs, lists, and code blocks when appropriate), then briefly tell the user to select “Save as PDF” below your answer to download a formatted, paginated PDF. If a needed detail is missing, ask a concise clarifying question before drafting. Do not claim that a file was already downloaded; the user initiates the download with that control.`;

export const appRouter = router({
  chat: router({
    respond: publicProcedure
      .input(z.object({ messages: z.array(chatMessage).min(1).max(24) }).strict())
      .mutation(async ({ input }) => {
        if (input.messages[input.messages.length - 1]?.role !== "user") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Add a question before sending." });
        }

        const messages: Message[] = [
          { role: "system", content: askOrbitInstructions },
          ...input.messages.map(message => ({ role: message.role, content: message.content })),
        ];

        try {
          const result = await invokeLLM({ messages });
          const content = result.choices?.[0]?.message?.content;
          const answer = typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.filter(part => part.type === "text").map(part => part.text).join("\n")
              : "";

          if (!answer.trim()) {
            throw new Error("The AI service returned an empty answer.");
          }
          return { answer };
        } catch {
          // Keep provider errors and credentials on the server; show a useful retry path to the visitor.
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: "The AI service couldn't return an answer just now. Please try again.",
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
