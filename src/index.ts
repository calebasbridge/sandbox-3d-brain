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
    
    // 1. CORS GATEKEEPER (Allow All for Dev)
    if (request.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders() });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: getCorsHeaders() });

    try {
      console.log("🧠 Neural Link Active...");
      
      const formData = await request.formData();
      const audioFile = formData.get("audio");

      if (!audioFile || !(audioFile instanceof File)) throw new Error("No audio file provided");
      console.log(`🎤 Received Audio: ${audioFile.size} bytes`);

      if (audioFile.size < 100) throw new Error("Audio file too short.");

      // STEP 1: LISTEN
      const sttFormData = new FormData();
      sttFormData.append("model_id", "scribe_v1");
      sttFormData.append("file", audioFile); 

      const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
        body: sttFormData,
      });

      if (!sttResponse.ok) {
        const err = await sttResponse.text();
        throw new Error(`ElevenLabs STT Failed: ${err}`);
      }
      
      const sttJson = await sttResponse.json() as any;
      const userText = sttJson.text || "";
      console.log(`🗣️ Heard: "${userText}"`);

      // STEP 2: THINK
      let aiText = "I couldn't hear you, Officer. Say again?";
      
      if (userText.trim().length > 1) {
        // Updated URL: Updated to Gemini 2.5-flash'
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: SYSTEM_PROMPT }, { text: `User said: "${userText}"` }] }]
          })
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

      // STEP 3: SPEAK
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
      newHeaders.set("X-User-Text", userText);
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