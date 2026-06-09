# German BPO Combat Arena

Full-stack AI-powered German interview trainer.

## Project structure

```
project/
├── server/
│   ├── package.json
│   ├── server.js
│   ├── websocketManager.js
│   ├── realtimeClient.js
│   └── .env.example
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── audioRecorder.js
        └── audioPlayer.js
```

## Setup

### 1. Server

```bash
cd server
cp .env.example .env
# Edit .env — add your OPENAI_API_KEY
npm install
npm run dev
```

Server runs on http://localhost:3001

### 2. Client

```bash
cd client
npm install
npm run dev
```

Client runs on http://localhost:5173

Open http://localhost:5173, click **INTERVIEW STARTEN**, allow microphone, and fight.

## Requirements

- Node.js >= 20
- OpenAI account with Realtime API access
- Chrome, Edge, or Safari 16+ (AudioWorklet required)
- Microphone

## How it works

1. Browser opens WebSocket to `ws://localhost:3001`
2. Server spawns an OpenAI Realtime API connection per session
3. Mic audio streams continuously at 24 kHz PCM16 (no push-to-talk)
4. OpenAI handles VAD, STT, and boss TTS — server relays audio back
5. HP scores update live based on fluency, filler words, and C1 vocabulary
