// src/index.ts

export interface Env {
  ELEVENLABS_API_KEY: string;
  GEMINI_API_KEY: string;
  VOICE_ID: string;
  ALLOWED_ORIGINS?: string;
}

const SYSTEM_PROMPT = `
You are Marcus Chen, an inmate in a medium-security correctional facility.
Context: You are sitting in the dayroom. A correctional officer (the user) is approaching you.
Current State: Anxious, guarded, but willing to talk if treated with respect.
Goal: You want to know if your commissary account has been unfrozen so you can call your sister.
Rules:
1. Keep responses SHORT (under 2 sentences). This is a spoken conversation.
2. Do not sound like an AI. Hesitate, use slang, be natural.
3. If the officer is aggressive, shut down. If they are helpful, open up.
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    
    // 1. CORS GATEKEEPER
    if (request.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders() });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: getCorsHeaders() });

    try {
      console.log("🧠 Neural Link Active...");
      
      const formData = await request.formData();
      const audioFile = formData.get("audio");
      const historyRaw = formData.get("history"); // New: Get history string

      if (!audioFile || !(audioFile instanceof File)) throw new Error("No audio file provided");

      // STEP 1: LISTEN (ElevenLabs STT)
      const sttFormData = new FormData();
      sttFormData.append("model_id", "scribe_v1");
      sttFormData.append("file", audioFile); 

      const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
        body: sttFormData,
      });

      if (!sttResponse.ok) {
        throw new Error(`ElevenLabs STT Failed`);
      }
      
      const sttJson = await sttResponse.json() as any;
      const userText = sttJson.text || "";
      console.log(`🗣️ Heard: "${userText}"`);

      // STEP 2: THINK (Gemini 2.5 Flash)
      let aiText = "I couldn't hear you, Officer. Say again?";
      
      if (userText.trim().length > 1) {
        
        // Parse Previous History
        let previousContext = [];
        try {
          if (typeof historyRaw === 'string') {
            previousContext = JSON.parse(historyRaw);
          }
        } catch (e) {
          console.warn("Failed to parse history", e);
        }

        // Construct Gemini Payload
        // We use system_instruction for the persona, and contents for the chat log
        const payload = {
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            ...previousContext, // Inject Memory
            { role: "user", parts: [{ text: userText }] } // Current input
          ]
        };

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
           const err = await geminiResponse.text();
           console.error(`Gemini Error: ${err}`);
           aiText = "My head hurts... (AI Error)"; 
        } else {
           const geminiJson = await geminiResponse.json() as any;
           aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || aiText;
        }
      }
      
      console.log(`🤖 Responding: "${aiText}"`);

      // STEP 3: SPEAK (ElevenLabs TTS)
      const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.VOICE_ID}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: aiText,
          model_id: "eleven_turbo_v2", 
          voice_settings: { stability: 0.5, similarity_boost: 0.7 }
        }),
      });

      if (!ttsResponse.ok) throw new Error(`ElevenLabs TTS Failed`);

      // STEP 4: RETURN
      const newHeaders = new Headers(getCorsHeaders());
      newHeaders.set("Content-Type", "audio/mpeg");
      newHeaders.set("X-Ai-Text", aiText);
      newHeaders.set("X-User-Text", userText); // Ensure we return what we heard
      newHeaders.set("Access-Control-Expose-Headers", "X-Ai-Text, X-User-Text");

      return new Response(ttsResponse.body, { headers: newHeaders });

    } catch (err: any) {
      console.error(err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: getCorsHeaders() });
    }
  }
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Max-Age": "86400",
  };
}