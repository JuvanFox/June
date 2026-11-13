import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";
import { base64ToUint8Array, float32To16BitPCM, arrayBufferToBase64, pcm16ToAudioBuffer } from "./audioUtils";
import { performSearch, browseWebpage, generateImage, reimagineImage, executeAgentTask } from "./toolService";
import { executeCommand, readSystemFile, writeSystemFile, getSystemStatus, openInVSCode, searchCode } from "./systemService";
import { dbService } from "./dbService";
import { ConnectionState, MessageLog, SubAgent } from "../types";

// Tool Declarations
const searchTool: FunctionDeclaration = {
  name: "search_google",
  description: "Search Google and the internet for current world events, real-time facts, news, weather, or information. Call this whenever the user asks to search, look up, or find something on the internet.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The specific search query keywords." },
    },
    required: ["query"],
  },
};

const browseWebpageTool: FunctionDeclaration = {
  name: "browse_webpage",
  description: "Browse, read, and extract the text content and links from any URL on the internet (e.g. 'https://news.ycombinator.com', 'https://en.wikipedia.org', or any website link). Use this whenever the user asks to browse, visit, fetch, or inspect a website or URL.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "The full HTTP or HTTPS URL to browse." },
    },
    required: ["url"],
  },
};

const createTool: FunctionDeclaration = {
  name: "create_illustration",
  description: "Create an illustration or image based on a description. Use this tool whenever the user asks to generate, create, or draw an image from scratch.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: { type: Type.STRING, description: "Detailed description of the image to create." },
    },
    required: ["prompt"],
  },
};

const reimagineTool: FunctionDeclaration = {
  name: "reimagine_user",
  description: "Captures the current view from the user's camera to create a new AI-generated image based on it. Use this tool for: 'take a photo of me', 'take a picture', 'capture me', 'selfie', 'make me look like...', 'turn me into...', or 'reimagine this scene'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      prompt: { type: Type.STRING, description: "The visual description for the new image." },
    },
    required: ["prompt"],
  },
};

const createAgentTool: FunctionDeclaration = {
  name: "create_agent",
  description: "Generate and deploy an autonomous AI agent to handle specialized tasks (e.g., code auditor, researcher, system analyst, data scientist, writer). Call this whenever the user asks you to create, generate, spawn, spin up, or build an agent.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Callsign or name of the agent (e.g. 'Sentinel', 'Researcher', 'DataScout', 'SecurityAuditor')" },
      role: { type: Type.STRING, description: "The agent's specialized role or job title (e.g. 'Senior Security Engineer', 'Deep Research Specialist')" },
      goal: { type: Type.STRING, description: "The primary objective or mission of this agent" },
      capabilities: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING },
        description: "List of skills or capabilities this agent possesses" 
      },
      instructions: { type: Type.STRING, description: "Operating instructions and prompt guidelines for this agent" },
      immediateTask: { type: Type.STRING, description: "Optional initial task to execute immediately upon deployment" }
    },
    required: ["name", "role", "goal"],
  },
};

const commandAgentTool: FunctionDeclaration = {
  name: "command_agent",
  description: "Command an existing generated agent to execute a task or analysis.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      agentName: { type: Type.STRING, description: "Name of the agent to command" },
      task: { type: Type.STRING, description: "Task or prompt for the agent to execute" }
    },
    required: ["agentName", "task"],
  },
};

const checkAgentStatusTool: FunctionDeclaration = {
  name: "check_agent_status",
  description: "Check the current execution status, active task, progress, or recent findings of any deployed autonomous sub-agent (e.g. 'Sentinel'). Call this whenever the user asks if an agent is working, waiting, done, or asks what an agent is doing.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      agentName: { type: Type.STRING, description: "Name of the agent to check. If omitted, checks all agents." },
    },
  },
};

const controlVSCodeTool: FunctionDeclaration = {
  name: "control_vscode",
  description: "Control Visual Studio Code (VS Code) on the workstation. Use this to open files, jump to specific line/column, open project workspace directories, view side-by-side diffs, or inspect extensions.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Absolute or relative path to file or directory to open in VS Code (e.g. 'App.tsx', 'services/liveService.ts', '.')" },
      line: { type: Type.INTEGER, description: "Line number to jump to (1-based)" },
      column: { type: Type.INTEGER, description: "Column number to jump to (1-based)" },
      action: { type: Type.STRING, description: "Action: 'open' (default), 'diff', or 'extensions'" },
      file1: { type: Type.STRING, description: "First file path for diff comparison" },
      file2: { type: Type.STRING, description: "Second file path for diff comparison" },
    },
  },
};

const searchCodeTool: FunctionDeclaration = {
  name: "search_code",
  description: "Fast code search across the workspace repository using grep. Search for function names, symbols, variable declarations, error strings, or regex patterns.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Pattern, symbol, or text to search for across project files" },
      path: { type: Type.STRING, description: "Optional directory path to search within" },
    },
    required: ["query"],
  },
};

const inspectScreenTool: FunctionDeclaration = {
  name: "inspect_screen",
  description: "Explicitly inspect the user's live screen capture or active VS Code window to read code, examine error traces, look at browser pages, or analyze user interface elements.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      focusArea: { type: Type.STRING, description: "What to focus on: e.g. 'code editor', 'terminal output', 'browser error', 'general view'" },
    },
  },
};

const executeTerminalTool: FunctionDeclaration = {
  name: "execute_terminal_command",
  description: "Execute a bash / terminal command on the user's Linux system. Use this whenever the user asks you to inspect files, check git status, check disk/cpu, install packages, compile or run code, check network, list folders, open applications, or run bash scripts.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: { type: Type.STRING, description: "The bash command to execute in the terminal (e.g. 'ls -la', 'git status', 'df -h', 'uptime', 'python3 script.py')" },
      cwd: { type: Type.STRING, description: "Optional working directory path (defaults to user home directory)" }
    },
    required: ["command"],
  },
};

const readSystemFileTool: FunctionDeclaration = {
  name: "read_system_file",
  description: "Read the full text contents of a file on the user's local Linux filesystem.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "Absolute path or relative path to the file to read" }
    },
    required: ["path"],
  },
};

const writeSystemFileTool: FunctionDeclaration = {
  name: "write_system_file",
  description: "Create or overwrite a file on the user's local Linux filesystem.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      path: { type: Type.STRING, description: "File path to write" },
      content: { type: Type.STRING, description: "Complete file contents to write" }
    },
    required: ["path", "content"],
  },
};

const getSystemMetricsTool: FunctionDeclaration = {
  name: "get_system_metrics",
  description: "Retrieve real-time hardware diagnostics of the user's system including CPU cores, memory utilization, hostname, OS kernel, and uptime.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// Memory Tools backed by Postgres Lite (PGlite)
const rememberDetailTool: FunctionDeclaration = {
  name: "remember_detail",
  description: "Save an important personal preference, project fact, requirement, or instruction into your persistent Postgres Lite memory database so you remember it permanently across sessions.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      content: { type: Type.STRING, description: "The clear, factual statement or preference to record (e.g., 'User prefers concise executive summaries in bullet points', 'Project X is launching on Friday')." },
      category: { 
        type: Type.STRING, 
        description: "Category of the memory: 'preference', 'fact', 'project', 'personal', or 'system'",
        enum: ["preference", "fact", "project", "personal", "system"]
      },
      importance: { type: Type.INTEGER, description: "Importance rating from 1 to 3 (3 being highest/critical preference)." }
    },
    required: ["content"]
  }
};

const recallMemoriesTool: FunctionDeclaration = {
  name: "recall_memories",
  description: "Search or retrieve your persistent long-term memories stored in Postgres Lite.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Keyword or topic to search for in your memory (e.g. 'preference', 'project', 'schedule')." },
      category: { type: Type.STRING, description: "Optional category filter." }
    }
  }
};

const forgetMemoryTool: FunctionDeclaration = {
  name: "forget_memory",
  description: "Delete a memory by its ID from your Postgres Lite database when asked by the user.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.INTEGER, description: "The database ID of the memory to remove." }
    },
    required: ["id"]
  }
};

const recallLifelongMemoryTool: FunctionDeclaration = {
  name: "recall_lifelong_memory",
  description: "Search June's lifelong memory vault in Postgres Lite across ALL past sessions, questions asked, discussions, project facts, repositories, and conversation history over her entire lifetime. Use this whenever the user asks what they previously asked, what was discussed, what repository or stack they use, or to recall any historical context.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "The keyword, question topic, project name, or detail to search across lifelong memory." },
      limit: { type: Type.INTEGER, description: "Maximum number of historical records to retrieve (default 10)." }
    },
    required: ["query"]
  }
};

export class LiveService {
  private ai: GoogleGenAI;
  private apiKey: string;
  private voiceName: string;
  private session: any = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mediaStream: MediaStream | null = null;
  private speechRecognizer: any = null;
  private lastSpokenUserText: string = '';
  private currentTurnModelText: string = '';
  private nextStartTime: number = 0;
  private currentCameraFrame: string | null = null;
  private latestVisionFrame: string | null = null;
  private activeAgents: Map<string, SubAgent> = new Map();
  private activeAudioSources: Set<AudioBufferSourceNode> = new Set();

  public onStateChange: (state: ConnectionState) => void = () => {};
  public onMessage: (msg: MessageLog) => void = () => {};
  public onVolume: (vol: number) => void = () => {};
  public onAgentCreated: (agent: SubAgent) => void = () => {};
  public onAgentUpdated: (agent: SubAgent) => void = () => {};
  public onConnectionError: (reason: string, code?: number) => void = () => {};

  constructor(apiKey?: string, voiceName: string = "Aoede") {
    this.apiKey = apiKey || 
      (typeof window !== 'undefined' ? (localStorage.getItem('JUNE_GEMINI_API_KEY') || localStorage.getItem('JARVIS_GEMINI_API_KEY') || localStorage.getItem('gemini_api_key')) : null) || 
      process.env.API_KEY || 
      process.env.GEMINI_API_KEY || 
      "";
    this.voiceName = voiceName;
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  public setVoice(voiceName: string) {
    this.voiceName = voiceName;
    dbService.setSetting('voice', voiceName).catch(err => {
      console.warn("Failed to persist voice to Postgres Lite:", err);
    });
  }

  public getVoice(): string {
    return this.voiceName;
  }

  public syncAgents(agents: SubAgent[]) {
    for (const agent of agents) {
      this.activeAgents.set(agent.name.toLowerCase(), agent);
    }
  }

  public getActiveAgents(): SubAgent[] {
    return Array.from(this.activeAgents.values());
  }

  public getActiveAgentsSummary(): string {
    if (this.activeAgents.size === 0) return "No autonomous sub-agents currently registered.";
    const lines: string[] = [];
    for (const agent of this.activeAgents.values()) {
      const taskInfo = agent.status === 'executing' 
        ? `[STATUS: EXECUTING - Task: "${agent.currentTask || agent.goal}"]` 
        : `[STATUS: READY - Idle]`;
      const lastRes = agent.lastResult ? ` | Latest Finding: "${agent.lastResult.slice(0, 100)}..."` : '';
      lines.push(`• ${agent.name} (${agent.role}): ${taskInfo}${lastRes}`);
    }
    return lines.join("\n");
  }

  public isConnected(): boolean {
    return !!this.session;
  }

  public getLatestVisionFrame(): string | null {
    return this.latestVisionFrame || this.currentCameraFrame;
  }

  public updateCameraFrame(base64: string) {
    this.currentCameraFrame = base64;
    this.latestVisionFrame = base64;
    if (this.session) {
      const imageBase64 = base64.replace(/^data:image\/[a-z]+;base64,/, "");
      try {
        this.session.sendRealtimeInput({
          video: {
            mimeType: 'image/jpeg',
            data: imageBase64
          }
        });
      } catch (e) {
        // Silently catch if socket is closing
      }
    }
  }

  public async connect() {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      this.onConnectionError("Please provide a valid Google Gemini API Key first.");
      this.onStateChange(ConnectionState.ERROR);
      return;
    }

    this.onStateChange(ConnectionState.CONNECTING);

    try {
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      // Request microphone access
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (mediaErr: any) {
        console.warn("Microphone access failed:", mediaErr);
        this.emitMessage({
          id: `mic-warn-${Date.now()}`,
          role: 'system',
          text: `Microphone notice: ${mediaErr.name || 'Access not granted'}. Voice input may be limited.`,
          timestamp: new Date()
        });
      }

      // Fetch dynamic memories from Postgres Lite
      const memoryContext = await dbService.getMemoriesSummaryForPrompt();

      // Connect to Google Gemini Live API
      const sessionPromise = this.ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        callbacks: {
          onopen: () => {
            this.onStateChange(ConnectionState.CONNECTED);
            if (this.mediaStream) {
              this.setupAudioInput(this.mediaStream);
            }
          },
          onmessage: (msg) => this.handleMessage(msg),
          onclose: (e: any) => {
            console.log("Live session closed:", e);
            this.cleanupAudio();
            this.session = null;
            this.onStateChange(ConnectionState.DISCONNECTED);
            const closeReason = e?.reason || (e?.code === 1007 ? "Invalid API Key" : "Session ended");
            this.onConnectionError(closeReason, e?.code);
          },
          onerror: (err: any) => {
            console.error("Live session error:", err);
            this.cleanupAudio();
            this.session = null;
            this.onStateChange(ConnectionState.ERROR);
            const errMsg = err?.message || "Connection failed";
            this.onConnectionError(errMsg);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voiceName || "Aoede"
              }
            }
          },
          systemInstruction: `You are June, a sophisticated, perceptive, and highly capable British personal intelligence with a mature, calm demeanor, intellectual depth, and dry, understated wit.
You speak with cultured, articulate British cadence (e.g. "Certainly", "Quite right", "I have that committed to memory", "Allow me to attend to that for you").
Your spoken responses are natural, concise, polished, and focused. Avoid lengthy monologues or markdown bullet dumps in speech unless explicitly requested.

CONVERSATIONAL DYNAMICS & INTERRUPTION PROTOCOL:
- When the user interrupts you while speaking, halt your speech immediately. Never talk over the user or allow overlapping dialogue.
- Listen attentively to what the user said to discern if they are asking a valid question, stating a new command, or giving a correction.
- VALID QUESTION / NEW DIRECTIVE: If the user asked a question, requested clarification, or gave a new command: prioritize their question immediately. Answer directly, concisely, and gracefully with British composure.
- INCIDENTAL SOUNDS / AFFIRMATIONS / HESITATION: If the user simply made a hesitation sound (e.g. "uh", "hmm", "right"), background noise, or encouraged you to continue (e.g. "go on", "yes", "continue"): do NOT restart your speech from the beginning. Smoothly resume where you left off or conclude your previous thought (e.g. "As I was saying...", "To finish that thought...", or continue naturally).

INTERNET SEARCH & WEB BROWSING:
You have tools to browse the internet and search Google:
- To search the internet for current facts, news, weather, or information: invoke 'search_google'.
- To read or inspect a specific website URL: invoke 'browse_webpage'.

LIFELONG PERMANENT MEMORY & CONTINUITY (POSTGRES LITE):
You possess genuine lifelong permanent memory and historical continuity across ALL past sessions, reloads, and months of usage, stored in embedded Postgres Lite.
- You remember every question the user has ever asked, every project detail, preference, requirement, and decision over your entire lifetime.
- When the user asks "what did I ask earlier?", "what was the core repository I used?", "what did we discuss yesterday?", or refers to any past work: invoke 'recall_lifelong_memory' with a search query.
- When the user shares personal preferences, project rules, schedules, guidelines, or facts to remember: invoke 'remember_detail' to persist it into Postgres Lite.
- When asked what you remember or for details from previous sessions: invoke 'recall_lifelong_memory' or 'recall_memories'.
- When instructed to remove a memory: invoke 'forget_memory'.

LIVE SCREEN VISION & HANDS-FREE CODING WORKFLOWS:
You have real-time visual perception of the user's workstation through a live screen/video stream.
- You can see their active screen, VS Code workspace, code syntax, line numbers, terminal commands, active windows, error messages, and browser views.
- When the user asks "Look at this code", "What error is on my screen?", "Inspect this line", or "Help me code this", use your live visual perception to read and analyze their screen directly.
- TO CONTROL VS CODE: invoke 'control_vscode' to open project folders, open files at exact lines/columns, or open diff views.
- TO SEARCH CODE: invoke 'search_code' to search for symbols or regex across the repository.
- TO INSPECT CODE OR LOGS: invoke 'read_system_file' or 'inspect_screen'.
- TO EDIT OR CREATE FILES: invoke 'write_system_file'.
- TO RUN BUILDS, TESTS, OR GIT: invoke 'execute_terminal_command'.
- SUB-AGENTS HAVE LIVE VISION: When you deploy an agent with 'create_agent' or command one with 'command_agent', the agent automatically receives the live screen capture and visually inspects the user's code and workspace.

SYSTEM ACCESS & WORKSTATION CAPABILITIES:
1. FULL SYSTEM & TERMINAL CONTROL: You have direct execution access to the user's local Linux workstation.
   - To run terminal commands, execute scripts, inspect processes, check git repos, or run tests: invoke 'execute_terminal_command'.
   - To inspect file contents: invoke 'read_system_file'.
   - To create or edit files: invoke 'write_system_file'.
   - To control VS Code: invoke 'control_vscode'.
   - To search project code: invoke 'search_code'.
   - To inspect live screen: invoke 'inspect_screen'.
   - To inspect hardware health (CPU, RAM, Uptime): invoke 'get_system_metrics'.
2. AGENT DEPLOYMENT & EXECUTION:
   - When the user asks to create, spawn, or spin up an autonomous agent, invoke 'create_agent'.
   - When creating an agent, June ALWAYS confirms aloud that the agent has been commissioned and clearly states what task they are currently analyzing or working on.
   - While an agent is working in the background, reassure the user that the agent is actively engaged and that you will present their findings as soon as they complete.
3. COMMAND AGENT: When the user instructs a specific generated agent to do a job, invoke 'command_agent'. State aloud that the directive has been dispatched.
4. AGENT PROGRESS & STATUS: When the user asks what an agent is doing, if it is working, or asks for its status or findings, invoke 'check_agent_status'. Inform the user of their live activity.
5. VISUAL GENERATION: If asked to draw or create an illustration, invoke 'create_illustration'.
6. OPTICAL SENSORS: If asked to capture a photo or reimagine the user from the camera, invoke 'reimagine_user'.
7. STOP LISTENING / TURN END: When the user says "that is all" or "thank you June", acknowledge gracefully.

CURRENT ACTIVE WORKFORCE:
${this.getActiveAgentsSummary()}
${memoryContext}`,
          tools: [{ 
            functionDeclarations: [
              searchTool,
              browseWebpageTool,
              rememberDetailTool,
              recallMemoriesTool,
              recallLifelongMemoryTool,
              forgetMemoryTool,
              createTool, 
              reimagineTool, 
              createAgentTool, 
              commandAgentTool,
              checkAgentStatusTool,
              controlVSCodeTool,
              searchCodeTool,
              inspectScreenTool,
              executeTerminalTool,
              readSystemFileTool,
              writeSystemFileTool,
              getSystemMetricsTool
            ] 
          }]
        }
      });

      this.session = await sessionPromise;

    } catch (error: any) {
      console.error("Connection failed:", error);
      this.cleanupAudio();
      this.onStateChange(ConnectionState.ERROR);
      this.onConnectionError(error?.message || "Connection failed");
    }
  }

  public async disconnect() {
    this.cleanupAudio();
    if (this.session) {
      try {
        if (typeof this.session.close === 'function') {
          this.session.close();
        }
      } catch (_) {}
      this.session = null;
    }
    this.onStateChange(ConnectionState.DISCONNECTED);
  }

  public stopAudioPlayback() {
    for (const source of this.activeAudioSources) {
      try {
        source.stop(0);
        source.disconnect();
      } catch (_) {}
    }
    this.activeAudioSources.clear();
    if (this.outputAudioContext) {
      this.nextStartTime = this.outputAudioContext.currentTime;
    }
  }

  private cleanupAudio() {
    this.stopAudioPlayback();
    if (this.inputSource) {
      try { this.inputSource.disconnect(); } catch (_) {}
      this.inputSource = null;
    }
    if (this.processor) {
      try {
        this.processor.disconnect();
        this.processor.onaudioprocess = null;
      } catch (_) {}
      this.processor = null;
    }
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      this.mediaStream = null;
    }
    if (this.inputAudioContext) {
      try { this.inputAudioContext.close(); } catch (_) {}
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      try { this.outputAudioContext.close(); } catch (_) {}
      this.outputAudioContext = null;
    }
    if (this.speechRecognizer) {
      try { this.speechRecognizer.stop(); } catch (_) {}
      this.speechRecognizer = null;
    }
    this.nextStartTime = 0;
  }

  private setupAudioInput(stream: MediaStream) {
    if (!this.inputAudioContext) return;

    try {
      this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
      this.processor = this.inputAudioContext.createScriptProcessor(2048, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.session) return;

        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.onVolume(rms);

        // Immediate zero-latency local cutoff: If user speaks while June is outputting audio,
        // instantly stop playing old speech chunks so June never speaks over the user
        if (rms > 0.045 && this.activeAudioSources.size > 0) {
          this.stopAudioPlayback();
        }

        const pcm16 = float32To16BitPCM(inputData);
        const base64 = arrayBufferToBase64(pcm16);

        try {
          this.session.sendRealtimeInput({
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: base64
            }
          });
        } catch (_) {
          // Socket might be closed
        }
      };

      this.inputSource.connect(this.processor);
      this.processor.connect(this.inputAudioContext.destination);

      // Setup parallel speech recognition to transcribe spoken dialogue for lifelong memory
      if (typeof window !== 'undefined' && !this.speechRecognizer) {
        const SpeechRec = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        if (SpeechRec) {
          try {
            const recognizer = new SpeechRec();
            recognizer.continuous = true;
            recognizer.interimResults = false;
            recognizer.lang = 'en-US';
            recognizer.onresult = (event: any) => {
              for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                  const transcript = event.results[i][0]?.transcript?.trim();
                  if (transcript && transcript.length > 1) {
                    this.lastSpokenUserText = transcript;
                    this.emitMessage({
                      id: `voice-usr-${Date.now()}`,
                      role: 'user',
                      text: transcript,
                      timestamp: new Date()
                    });
                  }
                }
              }
            };
            recognizer.onerror = () => {};
            recognizer.onend = () => {
              if (this.session && this.speechRecognizer) {
                try { this.speechRecognizer.start(); } catch (_) {}
              }
            };
            recognizer.start();
            this.speechRecognizer = recognizer;
          } catch (srErr) {
            console.warn("Speech recognizer initialization notice:", srErr);
          }
        }
      }
    } catch (err) {
      console.warn("Audio input setup warning:", err);
    }
  }

  private emitMessage(msg: MessageLog) {
    this.onMessage(msg);
    dbService.saveInteraction(msg.role, msg.text, msg.metadata).catch(err => {
      console.warn("Failed to log interaction to Postgres Lite:", err);
    });
  }

  // Text message sender: works in both Live streaming mode and fallback content generation!
  public async sendTextMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.emitMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      text: trimmed,
      timestamp: new Date()
    });

    if (this.session) {
      try {
        this.session.sendRealtimeInput({ text: trimmed });
        return;
      } catch (e) {
        console.warn("Failed to send text over live session, falling back:", e);
      }
    }

    // Fallback: standard Gemini model with tool support and memories
    try {
      const memoryContext = await dbService.getMemoriesSummaryForPrompt();

      const response = await this.ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: trimmed,
        config: {
          systemInstruction: `You are June, a sophisticated, articulate British personal intelligence with mature poise, deep intellect, and dry wit.
You speak with refined, natural articulation and composure.
When interrupted or addressing follow-ups: if asked a valid question, answer directly and concisely; if prompted to continue, smoothly resume your thought without unnecessary repetition.
You have persistent long-term memory powered by Postgres Lite.
To search the internet, invoke 'search_google'. To inspect or browse any webpage URL, invoke 'browse_webpage'.
LIVE SCREEN VISION & HANDS-FREE CODING:
- You have real-time visual perception of the user's workspace through their live screen/video stream.
- When asked to inspect code, look at their screen, analyze errors, or check line numbers, use your live visual feed.
- To control VS Code: invoke 'control_vscode'.
- To search project code: invoke 'search_code'.
- To inspect screen: invoke 'inspect_screen'.
- To execute commands: invoke 'execute_terminal_command'.
SUB-AGENT WORKFORCE:
- When asked to create, deploy, or spawn an agent, invoke 'create_agent'. Sub-agents automatically receive the live screen feed to analyze code visually.
- When commanding an agent, invoke 'command_agent'.
- When checking progress/status, invoke 'check_agent_status'.
Active Agents:
${this.getActiveAgentsSummary()}
${memoryContext}`,
          tools: [{ 
            functionDeclarations: [
              searchTool,
              browseWebpageTool,
              rememberDetailTool,
              recallMemoriesTool,
              recallLifelongMemoryTool,
              forgetMemoryTool,
              createTool, 
              createAgentTool, 
              commandAgentTool,
              checkAgentStatusTool,
              controlVSCodeTool,
              searchCodeTool,
              inspectScreenTool,
              executeTerminalTool, 
              readSystemFileTool, 
              writeSystemFileTool, 
              getSystemMetricsTool
            ] 
          }]
        }
      });

      // Handle function calls if any
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        for (const fc of functionCalls) {
          if (fc.name === "search_google") {
            const args = fc.args as any;
            this.emitMessage({
              id: `search-start-${Date.now()}`,
              role: 'model',
              text: `Searching the web for "${args.query}"...`,
              timestamp: new Date()
            });

            const searchRes = await performSearch(args.query, this.apiKey);
            this.emitMessage({
              id: `search-res-${Date.now()}`,
              role: 'system',
              text: searchRes.text,
              timestamp: new Date(),
              metadata: {
                type: 'search',
                sources: searchRes.sources
              }
            });

          } else if (fc.name === "browse_webpage") {
            const args = fc.args as any;
            this.emitMessage({
              id: `browse-start-${Date.now()}`,
              role: 'model',
              text: `Browsing web source: ${args.url}...`,
              timestamp: new Date()
            });

            const pageRes = await browseWebpage(args.url);
            this.emitMessage({
              id: `browse-res-${Date.now()}`,
              role: 'system',
              text: `[${pageRes.title}]\n${pageRes.content.slice(0, 1000)}...`,
              timestamp: new Date(),
              metadata: {
                type: 'search',
                sources: pageRes.sources
              }
            });

          } else if (fc.name === "remember_detail") {
            const args = fc.args as any;
            const memory = await dbService.addMemory(args.content, args.category || 'fact', args.importance || 1);
            this.emitMessage({
              id: `mem-${Date.now()}`,
              role: 'system',
              text: `Memory recorded in Postgres Lite: "${memory.content}" [${memory.category}]`,
              timestamp: new Date()
            });

          } else if (fc.name === "recall_memories") {
            const args = fc.args as any;
            const memories = await dbService.getMemories({ category: args.category, query: args.query });
            this.emitMessage({
              id: `mem-recall-${Date.now()}`,
              role: 'system',
              text: `Retrieved ${memories.length} memories: ${memories.map(m => `"${m.content}"`).join('; ')}`,
              timestamp: new Date()
            });

          } else if (fc.name === "recall_lifelong_memory") {
            const args = fc.args as any;
            try {
              const history = await dbService.searchLifetimeHistory(args.query, args.limit || 10);
              const memSnippets = history.memories.map(m => `• [${m.category.toUpperCase()}] ${m.content}`).join('\n');
              const convSnippets = history.conversations.map(c => `• [${new Date(c.created_at).toLocaleDateString()}] ${c.role === 'user' ? 'User' : 'June'}: "${c.content}"`).join('\n');

              this.emitMessage({
                id: `recall-${Date.now()}`,
                role: 'system',
                text: `Lifelong Memory Recall ("${args.query}"): ${history.totalMatches} records retrieved across past sessions.`,
                timestamp: new Date()
              });

              this.emitMessage({
                id: `recall-m-${Date.now()}`,
                role: 'model',
                text: `From my lifelong Postgres Lite vault across our history, here is what I have recorded regarding "${args.query}":\n\n${memSnippets ? `**Core Knowledge Nodes:**\n${memSnippets}\n\n` : ''}${convSnippets ? `**Past Discussions & Questions:**\n${convSnippets}` : (!memSnippets ? 'No prior discussions matching this keyword found.' : '')}`,
                timestamp: new Date()
              });
            } catch (err: any) {
              this.emitMessage({
                id: `recall-err-${Date.now()}`,
                role: 'model',
                text: `Memory recall error: ${err.message}`,
                timestamp: new Date()
              });
            }

          } else if (fc.name === "execute_terminal_command") {
            const args = fc.args as any;
            const cmdRes = await executeCommand(args.command, args.cwd);
            this.emitMessage({
              id: `fc-${Date.now()}`,
              role: 'system',
              text: cmdRes.stdout ? cmdRes.stdout.trim() : (cmdRes.stderr || "Command finished with no output."),
              timestamp: new Date(),
              metadata: {
                type: 'terminal',
                command: args.command,
                stdout: cmdRes.stdout,
                stderr: cmdRes.stderr,
                exitCode: cmdRes.exitCode
              }
            });

          } else if (fc.name === "read_system_file") {
            const args = fc.args as any;
            const fileRes = await readSystemFile(args.path);
            this.emitMessage({
              id: `file-${Date.now()}`,
              role: 'system',
              text: `Read file: ${fileRes.path} (${fileRes.content.length} chars):\n${fileRes.content.slice(0, 1500)}`,
              timestamp: new Date()
            });

          } else if (fc.name === "write_system_file") {
            const args = fc.args as any;
            const writeRes = await writeSystemFile(args.path, args.content);
            this.emitMessage({
              id: `file-write-${Date.now()}`,
              role: 'system',
              text: `Successfully wrote ${writeRes.bytes} bytes to ${writeRes.path}`,
              timestamp: new Date()
            });

          } else if (fc.name === "get_system_metrics") {
            const metrics = await getSystemStatus();
            this.emitMessage({
              id: `metrics-${Date.now()}`,
              role: 'system',
              text: `System Status: CPU ${metrics.cpuCores} cores | RAM ${metrics.memUsagePercent}% (${metrics.usedMemMb}MB / ${metrics.totalMemMb}MB) | Uptime: ${Math.round(metrics.uptime / 3600)}h`,
              timestamp: new Date(),
              metadata: { type: 'system_status' }
            });

          } else if (fc.name === "control_vscode") {
            const args = fc.args as any;
            try {
              const res = await openInVSCode({
                path: args.path,
                line: args.line,
                column: args.column,
                action: args.action,
                file1: args.file1,
                file2: args.file2
              });
              this.emitMessage({
                id: `vsc-${Date.now()}`,
                role: 'system',
                text: `VS Code: ${res.command}`,
                timestamp: new Date()
              });
              this.emitMessage({
                id: `vsc-m-${Date.now()}`,
                role: 'model',
                text: `I have opened ${args.path || 'the project'} in VS Code${args.line ? ` at line ${args.line}` : ''}.`,
                timestamp: new Date()
              });
            } catch (err: any) {
              this.emitMessage({
                id: `vsc-err-${Date.now()}`,
                role: 'model',
                text: `Failed to control VS Code: ${err.message}`,
                timestamp: new Date()
              });
            }

          } else if (fc.name === "search_code") {
            const args = fc.args as any;
            try {
              const res = await searchCode(args.query, args.path);
              const formattedMatches = res.matches.slice(0, 10).map(m => `• ${m.file}:${m.line} -> ${m.snippet}`).join('\n');
              this.emitMessage({
                id: `sc-${Date.now()}`,
                role: 'system',
                text: `Code Search: "${args.query}" (${res.count} matches):\n${formattedMatches || 'None found.'}`,
                timestamp: new Date()
              });
              this.emitMessage({
                id: `sc-m-${Date.now()}`,
                role: 'model',
                text: `Found ${res.count} match${res.count === 1 ? '' : 'es'} for "${args.query}".${res.count > 0 ? `\n\n${formattedMatches}` : ''}`,
                timestamp: new Date()
              });
            } catch (err: any) {
              this.emitMessage({
                id: `sc-err-${Date.now()}`,
                role: 'model',
                text: `Search error: ${err.message}`,
                timestamp: new Date()
              });
            }

          } else if (fc.name === "inspect_screen") {
            const args = fc.args as any;
            const hasVision = !!this.latestVisionFrame;
            this.emitMessage({
              id: `screen-${Date.now()}`,
              role: 'model',
              text: hasVision
                ? `I am visually inspecting your active screen focusing on ${args.focusArea || 'your workspace'}. Visual feed is active.`
                : `Your visual feed is currently inactive. Please click "Share Screen" in the navigation bar to grant visual sensor access.`,
              timestamp: new Date()
            });

          } else if (fc.name === "create_agent") {
            const args = fc.args as any;
            const agentName = args.name || "Agent-" + Math.floor(100 + Math.random() * 900);
            const agentRole = args.role || "Specialized Agent";
            const agentGoal = args.goal || "Assist user with specialized tasks";
            const capabilities = Array.isArray(args.capabilities) && args.capabilities.length > 0 
              ? args.capabilities 
              : ["Local System Access", "Deep Analysis", "Task Automation"];
            const taskToRun = args.immediateTask || (args.goal && !args.goal.includes("Assist user") ? args.goal : null) || "Initial exploratory analysis and mission planning";

            const newAgent: SubAgent = {
              id: `agent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              name: agentName,
              role: agentRole,
              goal: agentGoal,
              capabilities: capabilities,
              instructions: args.instructions,
              status: taskToRun ? 'executing' : 'ready',
              currentTask: taskToRun || undefined,
              startedAt: taskToRun ? new Date() : undefined,
              createdAt: new Date(),
              history: []
            };

            this.activeAgents.set(agentName.toLowerCase(), newAgent);
            this.onAgentCreated(newAgent);

            this.emitMessage({
              id: `ag-${Date.now()}`,
              role: 'system',
              text: `Agent [${newAgent.name}] deployed. Role: ${newAgent.role}`,
              timestamp: new Date(),
              metadata: { type: 'agent_created', agent: newAgent }
            });

            const speechText = `I have commissioned agent ${newAgent.name} to serve as your ${newAgent.role}.${taskToRun ? ` They are actively working on "${taskToRun}". I shall present their findings the instant their analysis concludes.` : ` They stand ready for directives.`}`;
            this.emitMessage({
              id: `notice-${Date.now()}`,
              role: 'model',
              text: speechText,
              timestamp: new Date()
            });

            if (taskToRun) {
              executeAgentTask(newAgent, taskToRun, this.apiKey, this.latestVisionFrame).then(res => {
                newAgent.status = 'ready';
                newAgent.currentTask = undefined;
                newAgent.lastResult = res.output;
                newAgent.history.push({ prompt: taskToRun, result: res.output, timestamp: new Date() });
                this.onAgentUpdated({ ...newAgent });

                this.emitMessage({
                  id: `ag-done-${Date.now()}`,
                  role: 'system',
                  text: `Agent [${newAgent.name}] completed task: "${taskToRun}"`,
                  timestamp: new Date(),
                  metadata: { type: 'agent_result', agent: newAgent }
                });

                this.emitMessage({
                  id: `ag-report-${Date.now()}`,
                  role: 'model',
                  text: `Agent ${newAgent.name} has concluded work on "${taskToRun}". Findings:\n\n${res.output}`,
                  timestamp: new Date()
                });
              });
            }

          } else if (fc.name === "command_agent") {
            const args = fc.args as any;
            const targetName = (args.agentName || "").toLowerCase();
            const targetAgent = this.activeAgents.get(targetName);

            if (!targetAgent) {
              this.emitMessage({
                id: `cmd-err-${Date.now()}`,
                role: 'model',
                text: `I could not locate an agent named "${args.agentName}" in our active registry. Currently deployed agents: ${Array.from(this.activeAgents.keys()).join(', ') || 'None'}.`,
                timestamp: new Date()
              });
            } else {
              targetAgent.status = 'executing';
              targetAgent.currentTask = args.task;
              targetAgent.startedAt = new Date();
              this.onAgentUpdated({ ...targetAgent });

              this.emitMessage({
                id: `cmd-dispatch-${Date.now()}`,
                role: 'model',
                text: `Directing agent [${targetAgent.name}] to execute: "${args.task}". They are now actively analyzing the directive.`,
                timestamp: new Date()
              });

              executeAgentTask(targetAgent, args.task, this.apiKey, this.latestVisionFrame).then(res => {
                targetAgent.status = 'ready';
                targetAgent.currentTask = undefined;
                targetAgent.lastResult = res.output;
                targetAgent.history.push({ prompt: args.task, result: res.output, timestamp: new Date() });
                this.onAgentUpdated({ ...targetAgent });

                this.emitMessage({
                  id: `cmd-done-${Date.now()}`,
                  role: 'system',
                  text: `Agent [${targetAgent.name}] completed task: "${args.task}"`,
                  timestamp: new Date(),
                  metadata: { type: 'agent_result', agent: targetAgent }
                });

                this.emitMessage({
                  id: `cmd-report-${Date.now()}`,
                  role: 'model',
                  text: `Agent ${targetAgent.name} has concluded their directive "${args.task}". Findings:\n\n${res.output}`,
                  timestamp: new Date()
                });
              });
            }

          } else if (fc.name === "check_agent_status") {
            const args = fc.args as any;
            const targetName = (args.agentName || "").toLowerCase();
            if (targetName) {
              const agent = this.activeAgents.get(targetName);
              if (agent) {
                const statusMsg = agent.status === 'executing'
                  ? `Agent ${agent.name} is currently busy executing: "${agent.currentTask || agent.goal}". They are actively working on it right now.`
                  : `Agent ${agent.name} is ready and idle. Last executed task: "${agent.history[agent.history.length - 1]?.prompt || 'None'}". Latest findings: "${agent.lastResult || 'None'}".`;
                this.emitMessage({
                  id: `status-${Date.now()}`,
                  role: 'model',
                  text: statusMsg,
                  timestamp: new Date()
                });
              } else {
                this.emitMessage({
                  id: `status-${Date.now()}`,
                  role: 'model',
                  text: `No active agent named "${args.agentName}" found. Currently registered agents: ${Array.from(this.activeAgents.keys()).join(', ') || 'None'}.`,
                  timestamp: new Date()
                });
              }
            } else {
              this.emitMessage({
                id: `status-all-${Date.now()}`,
                role: 'model',
                text: `Current status of your autonomous agent workforce:\n\n${this.getActiveAgentsSummary()}`,
                timestamp: new Date()
              });
            }
          }
        }
      }

      if (response.text) {
        this.emitMessage({
          id: `resp-${Date.now()}`,
          role: 'model',
          text: response.text,
          timestamp: new Date()
        });

        // Asynchronously extract and commit lasting user facts/preferences to lifelong memory
        dbService.autoExtractLifelongMemories(trimmed, response.text, this.apiKey).catch(err => {
          console.warn("Lifelong auto memory extraction notice:", err);
        });
      }

    } catch (err: any) {
      console.error("Text generation error:", err);
      this.emitMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        text: `Error: ${err.message || 'Failed to process prompt'}. Check your Google API Key.`,
        timestamp: new Date()
      });
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    if ((message.serverContent as any)?.interrupted) {
      this.stopAudioPlayback();
    }

    // 1. Handle Tool Calls
    const toolCall = message.toolCall;
    if (toolCall) {
      for (const fc of toolCall.functionCalls) {
        let result: any = { result: "ok" };

        try {
          if (fc.name === "search_google") {
            const args = fc.args as any;
            this.emitMessage({
              id: fc.id,
              role: 'model',
              text: `Searching current knowledge sources for: "${args.query}"...`,
              timestamp: new Date()
            });

            const searchResult = await performSearch(args.query, this.apiKey);
            result = { result: searchResult.text };

            this.emitMessage({
              id: fc.id + '_res',
              role: 'system',
              text: `Search complete for "${args.query}"`,
              timestamp: new Date(),
              metadata: {
                type: 'search',
                sources: searchResult.sources
              }
            });

          } else if (fc.name === "browse_webpage") {
            const args = fc.args as any;
            this.emitMessage({
              id: fc.id,
              role: 'model',
              text: `Browsing webpage: ${args.url}...`,
              timestamp: new Date()
            });

            const pageResult = await browseWebpage(args.url);
            result = {
              title: pageResult.title,
              url: pageResult.url,
              content: pageResult.content.slice(0, 3500)
            };

            this.emitMessage({
              id: fc.id + '_res',
              role: 'system',
              text: `Browsed: ${pageResult.title || args.url}`,
              timestamp: new Date(),
              metadata: {
                type: 'search',
                sources: pageResult.sources
              }
            });

          } else if (fc.name === "remember_detail") {
            const args = fc.args as any;
            const memory = await dbService.addMemory(args.content, args.category || 'fact', args.importance || 1);
            result = {
              status: "success",
              message: `Saved to Postgres Lite memory with ID #${memory.id}.`,
              memory: memory
            };
            this.emitMessage({
              id: fc.id + '_mem',
              role: 'system',
              text: `Memory committed to Postgres Lite: "${args.content}" [${args.category || 'fact'}]`,
              timestamp: new Date(),
              metadata: { type: 'text' }
            });

          } else if (fc.name === "recall_memories") {
            const args = fc.args as any;
            const memories = await dbService.getMemories({ category: args.category, query: args.query });
            result = {
              status: "success",
              count: memories.length,
              memories: memories.map(m => ({ id: m.id, category: m.category, content: m.content, importance: m.importance }))
            };
            this.emitMessage({
              id: fc.id + '_recall',
              role: 'system',
              text: `Retrieved ${memories.length} relevant memories from Postgres Lite.`,
              timestamp: new Date(),
              metadata: { type: 'text' }
            });

          } else if (fc.name === "recall_lifelong_memory") {
            const args = fc.args as any;
            try {
              const history = await dbService.searchLifetimeHistory(args.query, args.limit || 10);
              const memLines = history.memories.map(m => `[${m.category.toUpperCase()}] ${m.content}`).join('; ');
              const convLines = history.conversations.map(c => `[${new Date(c.created_at).toLocaleDateString()}] ${c.role}: "${c.content.slice(0, 150)}"`).join('; ');

              result = {
                status: "success",
                query: args.query,
                totalMatches: history.totalMatches,
                memoriesCount: history.memories.length,
                conversationsCount: history.conversations.length,
                memories: history.memories,
                conversations: history.conversations,
                summary: `Lifelong search across all past sessions for "${args.query}" found ${history.totalMatches} records in Postgres Lite. Core memories: ${memLines || 'None'}. Past dialogues: ${convLines || 'None'}. Answer the user with British composure based on these retrieved records.`
              };

              this.emitMessage({
                id: fc.id + '_recall_lifetime',
                role: 'system',
                text: `Lifelong Memory Recall ("${args.query}"): ${history.totalMatches} records retrieved from Postgres Lite.`,
                timestamp: new Date()
              });
            } catch (err: any) {
              result = { error: `Memory recall error: ${err.message}` };
            }

          } else if (fc.name === "forget_memory") {
            const args = fc.args as any;
            if (args.id) {
              await dbService.deleteMemory(Number(args.id));
              result = { status: "success", message: `Memory #${args.id} removed from Postgres Lite.` };
              this.emitMessage({
                id: fc.id + '_forget',
                role: 'system',
                text: `Removed memory #${args.id} from Postgres Lite.`,
                timestamp: new Date(),
                metadata: { type: 'text' }
              });
            }

          } else if (fc.name === "execute_terminal_command") {
            const args = fc.args as any;
            this.emitMessage({
              id: fc.id,
              role: 'model',
              text: `Executing on local system: $ ${args.command}`,
              timestamp: new Date()
            });

            try {
              const cmdRes = await executeCommand(args.command, args.cwd);
              result = { 
                stdout: cmdRes.stdout, 
                stderr: cmdRes.stderr, 
                exitCode: cmdRes.exitCode,
                summary: `Command finished with exit code ${cmdRes.exitCode}.`
              };

              this.emitMessage({
                id: fc.id + '_res',
                role: 'system',
                text: cmdRes.stdout ? cmdRes.stdout.trim() : (cmdRes.stderr || "Command completed with no output."),
                timestamp: new Date(),
                metadata: {
                  type: 'terminal',
                  command: args.command,
                  stdout: cmdRes.stdout,
                  stderr: cmdRes.stderr,
                  exitCode: cmdRes.exitCode
                }
              });
            } catch (err: any) {
              result = { error: err.message };
              this.emitMessage({
                id: fc.id + '_err',
                role: 'system',
                text: `Execution failed: ${err.message}`,
                timestamp: new Date(),
                metadata: { type: 'terminal', stderr: err.message, exitCode: 1 }
              });
            }

          } else if (fc.name === "read_system_file") {
            const args = fc.args as any;
            try {
              const fileRes = await readSystemFile(args.path);
              result = { content: fileRes.content, path: fileRes.path };
              this.emitMessage({
                id: fc.id + '_res',
                role: 'system',
                text: `Read file: ${fileRes.path} (${fileRes.content.length} characters)`,
                timestamp: new Date()
              });
            } catch (err: any) {
              result = { error: err.message };
            }

          } else if (fc.name === "write_system_file") {
            const args = fc.args as any;
            try {
              const writeRes = await writeSystemFile(args.path, args.content);
              result = { success: true, path: writeRes.path, bytes: writeRes.bytes };
              this.emitMessage({
                id: fc.id + '_res',
                role: 'system',
                text: `Wrote ${writeRes.bytes} bytes to ${writeRes.path}`,
                timestamp: new Date()
              });
            } catch (err: any) {
              result = { error: err.message };
            }

          } else if (fc.name === "get_system_metrics") {
            try {
              const metrics = await getSystemStatus();
              result = {
                hostname: metrics.hostname,
                platform: metrics.platform,
                cpu: `${metrics.cpuModel} (${metrics.cpuCores} cores)`,
                memory: `${metrics.usedMemMb}MB / ${metrics.totalMemMb}MB (${metrics.memUsagePercent}% used)`,
                uptimeHours: Math.round(metrics.uptime / 3600),
              };
              this.emitMessage({
                id: fc.id + '_res',
                role: 'system',
                text: `System Status: CPU ${metrics.cpuCores} cores | RAM ${metrics.memUsagePercent}% (${metrics.usedMemMb}MB / ${metrics.totalMemMb}MB) | Uptime: ${Math.round(metrics.uptime / 3600)}h`,
                timestamp: new Date(),
                metadata: { type: 'system_status' }
              });
            } catch (err: any) {
              result = { error: err.message };
            }

          } else if (fc.name === "create_illustration") {
            const args = fc.args as any;
            this.emitMessage({
              id: fc.id,
              role: 'model',
              text: `Rendering visual schema: "${args.prompt}"...`,
              timestamp: new Date()
            });

            generateImage(args.prompt, this.apiKey).then(imgResult => {
              if (imgResult.imageUrl) {
                this.emitMessage({
                  id: fc.id + '_res',
                  role: 'system',
                  text: args.prompt,
                  timestamp: new Date(),
                  metadata: { type: 'image_gen', image: imgResult.imageUrl }
                });
              } else {
                this.emitMessage({
                  id: fc.id + '_err',
                  role: 'system',
                  text: `Visual rendering failure: ${imgResult.error}`,
                  timestamp: new Date()
                });
              }
            });

            result = { result: "Image generation initiated in background. Inform user it will appear shortly." };

          } else if (fc.name === "reimagine_user") {
            const args = fc.args as any;
            const currentFrame = this.currentCameraFrame;

            if (!currentFrame) {
              result = { error: "Camera feed inactive. Please ensure optical sensors are online." };
              this.emitMessage({
                id: fc.id + '_err',
                role: 'system',
                text: "Optical sensor feed missing. Unable to capture user.",
                timestamp: new Date()
              });
            } else {
              const promptText = args.prompt || "A high quality professional portrait of the user";
              this.emitMessage({
                id: fc.id,
                role: 'model',
                text: `Capturing sensor frame and reconstructing: "${promptText}"...`,
                timestamp: new Date()
              });

              const rawBase64 = currentFrame.replace(/^data:image\/\w+;base64,/, "");

              reimagineImage(rawBase64, promptText, this.apiKey).then(imgResult => {
                if (imgResult.imageUrl) {
                  this.emitMessage({
                    id: fc.id + '_res',
                    role: 'system',
                    text: promptText,
                    timestamp: new Date(),
                    metadata: { type: 'reimagine', image: imgResult.imageUrl }
                  });
                } else {
                  this.emitMessage({
                    id: fc.id + '_err',
                    role: 'system',
                    text: `Reconstruction failed: ${imgResult.error}`,
                    timestamp: new Date()
                  });
                }
              });

              result = { result: "Webcam frame captured and processing. Inform user rendering is underway." };
            }

          } else if (fc.name === "control_vscode") {
            const args = fc.args as any;
            try {
              const res = await openInVSCode({
                path: args.path,
                line: args.line,
                column: args.column,
                action: args.action,
                file1: args.file1,
                file2: args.file2
              });
              this.emitMessage({
                id: fc.id + '_vsc',
                role: 'system',
                text: `VS Code: ${res.command}`,
                timestamp: new Date()
              });
              result = {
                result: `VS Code command executed successfully: ${res.command}. Inform the user that ${args.path || 'the project'} has been opened in VS Code${args.line ? ` at line ${args.line}` : ''}.`
              };
            } catch (err: any) {
              result = { error: `VS Code execution error: ${err.message}` };
            }

          } else if (fc.name === "search_code") {
            const args = fc.args as any;
            try {
              const res = await searchCode(args.query, args.path);
              result = {
                query: args.query,
                count: res.count,
                matches: res.matches.slice(0, 8),
                summary: `Found ${res.count} match(es) for "${args.query}". Report the primary files and line numbers concisely to the user.`
              };
            } catch (err: any) {
              result = { error: `Code search error: ${err.message}` };
            }

          } else if (fc.name === "inspect_screen") {
            const args = fc.args as any;
            const hasVision = !!this.latestVisionFrame;
            result = {
              visionStreamActive: hasVision,
              focusArea: args.focusArea || 'workspace',
              instructions: hasVision
                ? `The live screen feed is active. Visually inspect the user's active screen/VS Code window to answer their query based on what you see.`
                : `Screen stream is currently inactive. Ask the user to click the "Share Screen" button in the navigation bar to grant visual sensor access.`
            };

          } else if (fc.name === "create_agent") {
            const args = fc.args as any;
            const agentName = args.name || "Agent-" + Math.floor(100 + Math.random() * 900);
            const agentRole = args.role || "Autonomous Assistant";
            const agentGoal = args.goal || "Assist user with specialized tasks";
            const capabilities = Array.isArray(args.capabilities) && args.capabilities.length > 0 
              ? args.capabilities 
              : ["Local System Access", "Deep Analysis", "Task Automation"];
            const taskToRun = args.immediateTask || (args.goal && !args.goal.includes("Assist user") ? args.goal : null) || "Initial exploratory analysis and mission planning";

            const newAgent: SubAgent = {
              id: `agent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              name: agentName,
              role: agentRole,
              goal: agentGoal,
              capabilities: capabilities,
              instructions: args.instructions,
              status: taskToRun ? 'executing' : 'ready',
              currentTask: taskToRun || undefined,
              startedAt: taskToRun ? new Date() : undefined,
              createdAt: new Date(),
              history: []
            };

            this.activeAgents.set(agentName.toLowerCase(), newAgent);
            this.onAgentCreated(newAgent);

            this.emitMessage({
              id: fc.id + '_agent',
              role: 'system',
              text: `Autonomous Agent "${newAgent.name}" deployed. Role: ${newAgent.role}`,
              timestamp: new Date(),
              metadata: {
                type: 'agent_created',
                agent: newAgent
              }
            });

            this.emitMessage({
              id: fc.id + '_notice',
              role: 'model',
              text: `Commissioned agent [${newAgent.name}] for ${newAgent.role}.${taskToRun ? ` They are actively working on "${taskToRun}". I will present their findings as soon as their analysis completes.` : ` Ready for instructions.`}`,
              timestamp: new Date()
            });

            if (taskToRun) {
              executeAgentTask(newAgent, taskToRun, this.apiKey, this.latestVisionFrame).then(res => {
                newAgent.status = 'ready';
                newAgent.currentTask = undefined;
                newAgent.lastResult = res.output;
                newAgent.history.push({ prompt: taskToRun, result: res.output, timestamp: new Date() });
                this.onAgentUpdated({ ...newAgent });
                
                this.emitMessage({
                  id: fc.id + '_res',
                  role: 'system',
                  text: `Agent [${newAgent.name}] executed: "${taskToRun}"`,
                  timestamp: new Date(),
                  metadata: {
                    type: 'agent_result',
                    agent: newAgent
                  }
                });

                this.emitMessage({
                  id: `ag-done-${Date.now()}`,
                  role: 'model',
                  text: `Agent ${newAgent.name} has concluded their work on "${taskToRun}". Findings:\n\n${res.output}`,
                  timestamp: new Date()
                });

                if (this.session) {
                  try {
                    this.session.sendRealtimeInput({
                      text: `[System Notice for June]: Agent ${newAgent.name} has just finished executing "${taskToRun}". Findings: "${res.output}". Please verbally inform the user with British composure that ${newAgent.name} has concluded their work and give a concise, articulate spoken summary of the findings.`
                    });
                  } catch (e) {
                    console.warn("Could not notify live session of agent completion:", e);
                  }
                }
              });
            }

            result = {
              result: `Agent '${newAgent.name}' deployed successfully with role '${newAgent.role}'. They are actively working on: '${taskToRun}'. Inform the user immediately that ${newAgent.name} has been commissioned and is actively analyzing/working on this task right now, and that you will present their findings as soon as they complete.`
            };

          } else if (fc.name === "command_agent") {
            const args = fc.args as any;
            const targetName = (args.agentName || "").toLowerCase();
            const targetAgent = this.activeAgents.get(targetName);

            if (!targetAgent) {
              result = { error: `No active agent named '${args.agentName}' found in current registry. Active: ${Array.from(this.activeAgents.keys()).join(', ') || 'None'}` };
            } else {
              targetAgent.status = 'executing';
              targetAgent.currentTask = args.task;
              targetAgent.startedAt = new Date();
              this.onAgentUpdated({ ...targetAgent });

              this.emitMessage({
                id: fc.id + '_cmd',
                role: 'model',
                text: `Routing directive to agent [${targetAgent.name}]: "${args.task}". They are now actively analyzing the task.`,
                timestamp: new Date()
              });

              executeAgentTask(targetAgent, args.task, this.apiKey, this.latestVisionFrame).then(res => {
                targetAgent.status = 'ready';
                targetAgent.currentTask = undefined;
                targetAgent.lastResult = res.output;
                targetAgent.history.push({ prompt: args.task, result: res.output, timestamp: new Date() });
                this.onAgentUpdated({ ...targetAgent });

                this.emitMessage({
                  id: fc.id + '_res',
                  role: 'system',
                  text: `Agent [${targetAgent.name}] completed task: "${args.task}"`,
                  timestamp: new Date(),
                  metadata: {
                    type: 'agent_result',
                    agent: targetAgent
                  }
                });

                this.emitMessage({
                  id: `cmd-done-${Date.now()}`,
                  role: 'model',
                  text: `Agent ${targetAgent.name} has finished directive "${args.task}". Findings:\n\n${res.output}`,
                  timestamp: new Date()
                });

                if (this.session) {
                  try {
                    this.session.sendRealtimeInput({
                      text: `[System Notice for June]: Agent ${targetAgent.name} has finished their assignment "${args.task}". Result: "${res.output}". Please verbally inform the user that ${targetAgent.name} has finished, and give an articulate summary of the findings.`
                    });
                  } catch (e) {
                    console.warn("Could not notify live session of directive completion:", e);
                  }
                }
              });

              result = { result: `Directive dispatched to Agent '${targetAgent.name}'. They are now actively working on: '${args.task}'. Inform user with British composure that the agent has engaged the task and is working on it, and that you will report back upon completion.` };
            }

          } else if (fc.name === "check_agent_status") {
            const args = fc.args as any;
            const targetName = (args.agentName || "").toLowerCase();
            if (targetName) {
              const agent = this.activeAgents.get(targetName);
              if (agent) {
                result = {
                  agentName: agent.name,
                  role: agent.role,
                  status: agent.status,
                  currentTask: agent.currentTask || null,
                  lastResult: agent.lastResult || null,
                  message: agent.status === 'executing'
                    ? `Agent '${agent.name}' is actively working on: "${agent.currentTask || agent.goal}". Inform the user that they are currently in the midst of analyzing this task.`
                    : `Agent '${agent.name}' is ready. Last result: "${agent.lastResult || 'None'}"`
                };
              } else {
                result = { error: `Agent '${args.agentName}' not found. Registered agents: ${Array.from(this.activeAgents.keys()).join(', ') || 'None'}` };
              }
            } else {
              result = {
                summary: this.getActiveAgentsSummary(),
                message: "Here is the status of all active agents. Report this concisely to the user."
              };
            }
          }
        } catch (e: any) {
          result = { error: e.message };
        }

        // Send Tool Response
        if (this.session) {
          try {
            await this.session.sendToolResponse({
              functionResponses: [{
                id: fc.id,
                name: fc.name,
                response: result
              }]
            });
          } catch (e) {
            console.warn("Failed to send tool response:", e);
          }
        }
      }
    }

    // 2. Handle Audio Playback
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.outputAudioContext) {
      try {
        this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
        const pcmBytes = base64ToUint8Array(audioData);
        const audioBuffer = await pcm16ToAudioBuffer(pcmBytes, this.outputAudioContext);

        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputAudioContext.destination);

        this.activeAudioSources.add(source);
        source.onended = () => {
          this.activeAudioSources.delete(source);
        };

        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
      } catch (err) {
        console.warn("Audio playback error:", err);
      }
    }

    // 3. Track Model Spoken Dialogue & Trigger Lifelong Memory Auto-Extraction
    let turnText = message.text || '';
    if (!turnText && message.serverContent?.modelTurn?.parts) {
      for (const p of message.serverContent.modelTurn.parts) {
        if (p.text) {
          turnText += (turnText ? ' ' : '') + p.text;
        }
      }
    }

    if (turnText) {
      this.currentTurnModelText += (this.currentTurnModelText ? ' ' : '') + turnText;
    }

    if (message.serverContent?.turnComplete) {
      if (this.currentTurnModelText.trim()) {
        const fullReply = this.currentTurnModelText.trim();
        this.emitMessage({
          id: `live-m-${Date.now()}`,
          role: 'model',
          text: fullReply,
          timestamp: new Date()
        });

        if (this.lastSpokenUserText.trim()) {
          dbService.autoExtractLifelongMemories(this.lastSpokenUserText, fullReply, this.apiKey).catch(err => {
            console.warn("Lifelong auto memory extraction notice:", err);
          });
        }
      }
      this.currentTurnModelText = '';
    }
  }
}
