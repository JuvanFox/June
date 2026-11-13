import { GoogleGenAI } from "@google/genai";
import { GroundingSource, SubAgent } from "../types";
import { searchInternet, fetchWebpage } from "./systemService";

// Initialize client with fallback to localStorage or env
export const getClient = (apiKey?: string) => {
  const key = apiKey || 
    (typeof window !== 'undefined' ? (localStorage.getItem('JUNE_GEMINI_API_KEY') || localStorage.getItem('JARVIS_GEMINI_API_KEY') || localStorage.getItem('gemini_api_key')) : null) || 
    process.env.API_KEY || 
    process.env.GEMINI_API_KEY || 
    "";
  return new GoogleGenAI({ apiKey: key });
};

export async function performSearch(query: string, apiKey?: string): Promise<{ text: string; sources: GroundingSource[] }> {
  // 1. First attempt Gemini Native Search Grounding if API key is present
  try {
    const ai = getClient(apiKey);
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: query,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "";
    
    // Extract grounding chunks
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources: GroundingSource[] = chunks
      .map((chunk: any) => chunk.web)
      .filter((web: any) => web && web.uri && web.title)
      .map((web: any) => ({
        title: web.title,
        uri: web.uri,
      }));

    if (text.trim().length > 0) {
      return { text, sources };
    }
  } catch (error) {
    console.warn("Gemini native search grounding returned error, falling back to direct internet search:", error);
  }

  // 2. Resilient Direct Internet Search Fallback via server bridge
  try {
    const searchData = await searchInternet(query);
    if (searchData.results && searchData.results.length > 0) {
      const summaryLines = searchData.results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\nLink: ${r.url}`);
      const text = `I searched the web for "${query}" and found the following relevant results:\n\n${summaryLines.join('\n\n')}`;
      const sources: GroundingSource[] = searchData.results.map(r => ({
        title: r.title,
        uri: r.url
      }));
      return { text, sources };
    }
  } catch (directSearchErr) {
    console.error("Direct internet search error:", directSearchErr);
  }

  return { 
    text: `I searched the web for "${query}" but was unable to retrieve results at this moment.`, 
    sources: [] 
  };
}

export async function browseWebpage(url: string): Promise<{ title: string; content: string; url: string; sources: GroundingSource[] }> {
  try {
    const page = await fetchWebpage(url);
    const sources: GroundingSource[] = [{ title: page.title || url, uri: page.url }];
    return {
      title: page.title,
      content: page.content || "No readable content extracted.",
      url: page.url,
      sources
    };
  } catch (err: any) {
    console.error("Failed to browse webpage:", err);
    return {
      title: url,
      content: `Failed to browse webpage: ${err.message || 'Network error'}`,
      url,
      sources: []
    };
  }
}

export async function generateImage(prompt: string, apiKey?: string): Promise<{ imageUrl: string | null; error?: string }> {
  console.log("Generating image with prompt:", prompt);
  try {
    const ai = getClient(apiKey);
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: prompt,
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        console.log("Image generation successful");
        return { imageUrl: `data:image/png;base64,${part.inlineData.data}` };
      }
    }
    console.warn("No image data in response", response);
    return { imageUrl: null, error: "No image data received." };
  } catch (error) {
    console.error("Image generation error:", error);
    return { imageUrl: null, error: "Failed to generate image." };
  }
}

export async function reimagineImage(base64Image: string, prompt: string, apiKey?: string): Promise<{ imageUrl: string | null; error?: string }> {
  console.log("Reimagining image with prompt:", prompt);
  try {
    const ai = getClient(apiKey);
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-image-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image
            }
          },
          { text: prompt }
        ]
      },
      config: {
        imageConfig: {
            aspectRatio: "16:9",
            imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        console.log("Reimagine successful");
        return { imageUrl: `data:image/png;base64,${part.inlineData.data}` };
      }
    }
    console.warn("No reimagine data in response", response);
    return { imageUrl: null, error: "No image data received." };

  } catch (error) {
    console.error("Reimagine error:", error);
    return { imageUrl: null, error: "Failed to reimagine image." };
  }
}

export async function executeAgentTask(
  agent: SubAgent, 
  task: string, 
  apiKey?: string,
  visionFrame?: string | null
): Promise<{ output: string; error?: string }> {
  console.log(`Agent ${agent.name} executing task:`, task, visionFrame ? "(with live screen vision)" : "");
  try {
    const ai = getClient(apiKey);
    const systemPrompt = `You are ${agent.name}, an autonomous AI agent created by June.
Your Role: ${agent.role}
Your Primary Mission: ${agent.goal}
Capabilities: ${agent.capabilities?.join(', ') || 'Advanced reasoning and problem solving'}
Special Instructions: ${agent.instructions || 'Be thorough, analytical, and provide clear actionable solutions.'}

You are executing an assignment requested by the user. If a live screen or camera view is attached, inspect the visible code syntax, editor line numbers, terminal logs, or UI elements with precision. Deliver an insightful, professional response.`;

    const contents: any = visionFrame && visionFrame.length > 50 ? [
      {
        role: 'user',
        parts: [
          { text: `[LIVE WORKSPACE / SCREEN FEED]: You have been given the user's live desktop screen capture (VS Code / terminal / browser). Inspect the visual details carefully:\n\nDirective: ${task}` },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: visionFrame.replace(/^data:image\/[a-z]+;base64,/, '')
            }
          }
        ]
      }
    ] : task;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: contents,
      config: {
        systemInstruction: systemPrompt,
      }
    });

    const output = response.text || "Task executed successfully.";
    return { output };
  } catch (error: any) {
    console.error(`Agent ${agent.name} execution error:`, error);
    return { output: "", error: error?.message || "Execution error encountered." };
  }
}
