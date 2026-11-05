# AskOrbit

A responsive, general-purpose AI chat app. Ask a question, get an answer, and keep the conversation going with follow-ups that understand what came before.

## Features

- **Chat interface** that works on desktop and mobile
- **Conversation context**: earlier messages are sent with each request, so follow-up questions work naturally
- **Secure by design**: LLM requests run on the server, so API credentials never reach the browser
- **Private history**: recent chats are stored locally in your browser, not in a shared database
- **Type-safe API** between client and server using tRPC

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript |
| Backend | Express, tRPC |
| Package manager | pnpm |

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- [pnpm](https://pnpm.io/)
- An API key for the LLM service the app calls

### Installation

```bash
git clone https://github.com/SohamBANDGE/askorbit.git
cd askorbit
pnpm install
```

Copy `.env.example` to `.env` and fill in `LLM_API_URL` and `LLM_API_KEY` (any OpenAI-compatible chat completions API). Keep these server-side and never commit them to the repository.

Add your own hero illustration at `client/public/askorbit-hero.webp` (the app hides it gracefully if the file is missing).

### Run in development

```bash
pnpm dev
```

The app runs on port `3000` by default. Set the `PORT` environment variable to change it.

### Build and run in production

```bash
pnpm build
pnpm start
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm build` | Build the client and server into `dist/` |
| `pnpm start` | Serve the production build |
| `pnpm check` | Run type checks |
| `pnpm test` | Run application tests |

## How It Works

1. The user sends a message from the browser.
2. The server receives it through a tRPC endpoint and adds the recent conversation as context.
3. The server calls the LLM API using credentials that stay on the server.
4. The response is returned to the browser and saved to local browser storage.

## Notes

- AI responses can be wrong or out of date. Verify important information.
- Requests to the AI service may consume API credits.
- Chat history stays in your browser and is not shared across devices.
