// Accounts currently IN a live interview (fight). Populated by websocketManager on fight start and
// released on end/close. Shared so the TTS/STT endpoints can authorize voice BY ACTIVE SESSION —
// a user in a legitimately-granted fight (e.g. the one-time post-trial FREE interview) needs the boss
// voice even though their standalone daily-minute balance is 0. Without this, that free interview
// silently plays in the robotic fallback voice (the exact conversion moment). $0, in-memory.
export const activeFightUsers = new Set();
