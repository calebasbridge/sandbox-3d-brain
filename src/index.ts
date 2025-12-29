// src/index.ts

export interface Env {
  ELEVENLABS_API_KEY: string;
  GEMINI_API_KEY: string;
  VOICE_ID: string;
}

// -----------------------------------------------------------------------------
// 1. SYSTEM PROMPT (LITE VERSION FOR 3D MVP)
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// 2. HELPER: CORS
// -----------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// -----------------------------------------------------------------------------
// 3. MAIN WORKER LOGIC
// -----------------------------------------------------------------------------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Handle CORS Preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      console.log("🧠 Neural Link Active: Processing Audio...");
      
      // A. Parse the uploaded audio file from the React Frontend
      const formData = await req.formData();
      const audioFile = formData.get("audio");

      if (!audioFile || !(audioFile instanceof File)) {
        throw new Error("No audio file provided");
      }

      const arrayBuffer = await audioFile.arrayBuffer();

      // -----------------------------------------------------------------------
      // STEP B: SPEECH-TO-TEXT (ElevenLabs Scribe)
      // -----------------------------------------------------------------------
      const sttFormData = new FormData();
      sttFormData.append("model_id", "scribe_v1");
      sttFormData.append("file", new File([arrayBuffer], "audio.webm", { type: "audio/webm" }));

      const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
        body: sttFormData,
      });

      if (!sttResponse.ok) {
        const err = await sttResponse.text();
        throw new Error(`ElevenLabs STT Failed: ${err}`);
      }
      
      // FIX: Cast to 'any' to bypass TypeScript strictness
      const sttJson = await sttResponse.json() as any;
      const userText = sttJson.text;
      console.log("🗣️ Heard:", userText);

      // -----------------------------------------------------------------------
      // STEP C: INTELLIGENCE (Google Gemini 1.5 Flash)
      // -----------------------------------------------------------------------
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      
      const geminiPayload = {
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT }, 
              { text: `User said: "${userText}"` }
            ]
          }
        ]
      };

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      });

      if (!geminiResponse.ok) {
         const err = await geminiResponse.text();
         throw new Error(`Gemini API Failed: ${err}`);
      }

      // FIX: Cast to 'any' to bypass TypeScript strictness
      const geminiJson = await geminiResponse.json() as any;
      const aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "...";
      console.log("🤖 Thinking:", aiText);

      // -----------------------------------------------------------------------
      // STEP D: TEXT-TO-SPEECH (ElevenLabs)
      // -----------------------------------------------------------------------
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

      if (!ttsResponse.ok) {
         const err = await ttsResponse.text();
         throw new Error(`ElevenLabs TTS Failed: ${err}`);
      }

      // -----------------------------------------------------------------------
      // STEP E: RETURN PACKAGE
      // -----------------------------------------------------------------------
      const newHeaders = new Headers(corsHeaders);
      newHeaders.set("Content-Type", "audio/mpeg");
      newHeaders.set("X-Ai-Text", aiText); 
      newHeaders.set("X-User-Text", userText); 
      newHeaders.set("Access-Control-Expose-Headers", "X-Ai-Text, X-User-Text");

      return new Response(ttsResponse.body, { headers: newHeaders });

    } catch (err: any) {
      console.error(err);
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};