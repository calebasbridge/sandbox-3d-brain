// REMOVED: import { Env } from './worker-configuration';

// 1. DEFINE ENV INTERFACE LOCALLY (Fixes the "Cannot find module" error)
export interface Env {
  ELEVENLABS_API_KEY: string;
  GEMINI_API_KEY: string;
  VOICE_ID: string;
  ALLOWED_ORIGINS?: string;
}

// Helper for CORS headers
function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ai-Text, X-User-Text, X-Compliance-Score",
    "Access-Control-Expose-Headers": "X-Ai-Text, X-User-Text, X-Compliance-Score" 
  };
}

// Define the shape of the Gemini response
interface BrainResponse {
  text: string;
  compliance: number;
  reasoning: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    
    // 2. CORS GATEKEEPER
    if (request.method === "OPTIONS") return new Response(null, { headers: getCorsHeaders() });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: getCorsHeaders() });

    try {
      console.log("🧠 Neural Link Active...");
      
      const formData = await request.formData();
      const audioFile = formData.get("audio");
      const historyRaw = formData.get("history") as string; 

      if (!audioFile || !(audioFile instanceof File)) throw new Error("No audio file provided");

      // STEP 1: HEAR (ElevenLabs Scribe - Speech to Text)
      const scribeFormData = new FormData();
      scribeFormData.append("file", audioFile);
      scribeFormData.append("model_id", "scribble_google_v1"); 

      const sttResponse = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
        body: scribeFormData,
      });

      if (!sttResponse.ok) throw new Error(`ElevenLabs STT Failed: ${sttResponse.statusText}`);
      const sttData = await sttResponse.json() as { text: string };
      const userText = sttData.text;

      console.log(`👂 Heard: "${userText}"`);

      // STEP 2: THINK (Gemini 2.0 Flash - JSON Mode)
      // Parse history if it exists
      let history = [];
      try {
        if (historyRaw) history = JSON.parse(historyRaw);
      } catch (e) {
        console.warn("Failed to parse history", e);
      }

      const systemPrompt = `
        You are Marcus Chen, an inmate in a medium-security correctional facility.
        
        **YOUR SITUATION:**
        * Stressed. Sister arrested 3 days ago. Commissary frozen. Can't call home.
        * Sitting in Day Room. NOT violent, but frustrated and skeptical.
        
        **YOUR OBJECTIVE:**
        1. Respond naturally (keep it spoken, casual, under 2 sentences).
        2. Assign a "Compliance Score" (0-100) to the user (Correctional Officer).
           - 0-30: Hostile/Dismissive.
           - 31-70: Neutral/By the book.
           - 71-100: Empathetic/Validating.

        **OUTPUT FORMAT:**
        Return pure JSON:
        {
          "text": "Your spoken response.",
          "compliance": 50,
          "reasoning": "Why you gave this score."
        }
      `;

      const geminiPayload = {
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          ...history.map((msg: any) => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
          })),
          { role: "user", parts: [{ text: userText }] }
        ],
        generationConfig: {
          response_mime_type: "application/json" // FORCE JSON
        }
      };

      const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload)
      });

      const geminiData: any = await geminiResponse.json();
      const rawJSON = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawJSON) throw new Error("Gemini returned empty response");

      // Parse Gemini's JSON
      const brainData: BrainResponse = JSON.parse(rawJSON);
      console.log(`🤖 Thinking:`, brainData);

      // STEP 3: SPEAK (ElevenLabs Turbo - Text to Speech)
      // We use brainData.text for the audio
      const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.VOICE_ID}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: brainData.text,
          model_id: "eleven_turbo_v2", 
          voice_settings: { stability: 0.5, similarity_boost: 0.7 }
        }),
      });

      if (!ttsResponse.ok) throw new Error(`ElevenLabs TTS Failed`);

      // STEP 4: RETURN RESPONSE (Audio + Headers)
      const responseHeaders = new Headers(getCorsHeaders());
      responseHeaders.set("Content-Type", "audio/mpeg");
      responseHeaders.set("X-Ai-Text", brainData.text);
      responseHeaders.set("X-User-Text", userText);
      responseHeaders.set("X-Compliance-Score", brainData.compliance.toString()); // PASS THE SCORE

      return new Response(ttsResponse.body, { headers: responseHeaders });

    } catch (err: any) {
      console.error(err);
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...getCorsHeaders(), "Content-Type": "application/json" } 
      });
    }
  },
};