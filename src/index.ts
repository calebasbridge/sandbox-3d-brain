// src/index.ts

export interface Env {
  ELEVENLABS_API_KEY: string;
  GEMINI_API_KEY: string;
  VOICE_ID: string;
  ALLOWED_ORIGINS?: string; // Added to support CORS config
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
// 2. MAIN WORKER LOGIC
// -----------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    
    // A. HANDLE PREFLIGHT (The "Knock")
    if (request.method === "OPTIONS") {
      const headers = getCorsHeaders(request, env);
      return new Response(null, {
        headers: headers
      });
    }

    if (request.method !== "POST") {
      // Use dynamic headers even for errors
      const headers = getCorsHeaders(request, env);
      return new Response("Method not allowed", { status: 405, headers: headers });
    }

    try {
      console.log("🧠 Neural Link Active: Processing Audio...");
      
      // B. Parse the uploaded audio file from the React Frontend
      const formData = await request.formData();
      const audioFile = formData.get("audio");

      if (!audioFile || !(audioFile instanceof File)) {
        throw new Error("No audio file provided");
      }

      const arrayBuffer = await audioFile.arrayBuffer();

      // -----------------------------------------------------------------------
      // STEP C: SPEECH-TO-TEXT (ElevenLabs Scribe)
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
      
      const sttJson = await sttResponse.json() as any;
      const userText = sttJson.text;
      console.log("🗣️ Heard:", userText);

      // -----------------------------------------------------------------------
      // STEP D: INTELLIGENCE (Google Gemini 1.5 Flash)
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

      const geminiJson = await geminiResponse.json() as any;
      const aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text || "...";
      console.log("🤖 Thinking:", aiText);

      // -----------------------------------------------------------------------
      // STEP E: TEXT-TO-SPEECH (ElevenLabs)
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
      // STEP F: RETURN PACKAGE (Dynamic Headers)
      // -----------------------------------------------------------------------
      
      // 1. Get the VIP Pass (Dynamic CORS)
      const dynamicHeaders = getCorsHeaders(request, env);
    
      // 2. Wrap it in a Headers object so we can add more info
      const newHeaders = new Headers(dynamicHeaders);

      // 3. Add the specific info for this Audio response
      newHeaders.set("Content-Type", "audio/mpeg");
      newHeaders.set("X-Ai-Text", aiText);
      newHeaders.set("X-User-Text", userText);
      newHeaders.set("Access-Control-Expose-Headers", "X-Ai-Text, X-User-Text");

      // 4. Return the Final Package
      return new Response(ttsResponse.body, { headers: newHeaders });

    } catch (err: any) {
      console.error(err);
      
      // Use dynamic headers for the error response too
      const errorHeaders = getCorsHeaders(request, env);
      
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: errorHeaders 
      });
    }
  }
}

// -----------------------------------------------------------------------------
// 3. HELPER: CORS (Dynamic)
// -----------------------------------------------------------------------------
function getCorsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS || "").split(",");
  
  // Check if the requester is on the VIP list
  if (origin && allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Max-Age": "86400",
    };
  }
  
  // Default fallback (safe/strict)
  return {
    "Access-Control-Allow-Origin": allowedOrigins[0] || "http://localhost:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400", // <--- ADDED THIS TO FIX TYPE ERRORS
  };
}