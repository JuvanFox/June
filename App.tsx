import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LiveService } from './services/liveService';
import { dbService } from './services/dbService';
import { executeAgentTask } from './services/toolService';
import { executeCommand, getSystemStatus, SystemStatus, openInVSCode, searchCode } from './services/systemService';
import { ConnectionState, MessageLog, SubAgent, MemoryItem, VoiceOption } from './types';
import JuneOrb3D from './components/JuneOrb3D';
import VisionSensor, { VisionMode } from './components/VisionSensor';
import { 
  Mic, 
  MicOff, 
  Terminal, 
  Bot, 
  Send, 
  Sparkles, 
  ChevronLeft, 
  ChevronRight, 
  Volume2, 
  AlertTriangle,
  Layers,
  Square,
  Activity,
  Database,
  Search,
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Check,
  Settings2,
  Camera,
  Monitor,
  Eye,
  FolderCode,
  ExternalLink,
  Code2
} from 'lucide-react';

export const VOICES: VoiceOption[] = [
  { 
    id: 'Aoede', 
    label: 'Aoede', 
    desc: 'British mature woman — refined, cultured, articulate & poised', 
    gender: 'female', 
    accent: 'British (Mature)', 
    recommended: true 
  },
  { 
    id: 'Kore', 
    label: 'Kore', 
    desc: 'Direct & articulate — clear, structured, modern feminine tone', 
    gender: 'female', 
    accent: 'Neutral' 
  },
  { 
    id: 'Fenrir', 
    label: 'Fenrir', 
    desc: 'Stately & authoritative — deep, calm masculine resonance', 
    gender: 'male', 
    accent: 'British / Deep' 
  },
  { 
    id: 'Puck', 
    label: 'Puck', 
    desc: 'Upbeat & agile — lively, engaging, and spirited tempo', 
    gender: 'male', 
    accent: 'Neutral' 
  },
  { 
    id: 'Charon', 
    label: 'Charon', 
    desc: 'Low & resonant — measured, low cadence with depth', 
    gender: 'male', 
    accent: 'Deep' 
  },
  { 
    id: 'Zephyr', 
    label: 'Zephyr', 
    desc: 'Warm & contemporary — smooth, natural conversational flow', 
    gender: 'female', 
    accent: 'Contemporary' 
  },
];

export default function App() {
  const [apiKey, setApiKey] = useState<string>('');
  const [inputKey, setInputKey] = useState<string>('');
  const [hasKey, setHasKey] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // Voice & Settings State (Persisted in Postgres Lite)
  const [selectedVoice, setSelectedVoice] = useState<string>('Aoede');
  const [state, setState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [volume, setVolume] = useState(0);
  const [messages, setMessages] = useState<MessageLog[]>([]);
  const [activeMedia, setActiveMedia] = useState<MessageLog | null>(null);
  const [chatInput, setChatInput] = useState('');

  // UI Drawer Controls
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(false);
  const [leftTab, setLeftTab] = useState<'memories' | 'sql' | 'sensors'>('memories');
  const [rightTab, setRightTab] = useState<'agents' | 'terminal' | 'activity'>('agents');
  const [visionActive, setVisionActive] = useState<boolean>(false);
  const [visionMode, setVisionMode] = useState<VisionMode>('screen');
  
  // Postgres Lite Memory State
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memorySearch, setMemorySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryCategory, setNewMemoryCategory] = useState<string>('preference');
  const [newMemoryImportance, setNewMemoryImportance] = useState<number>(2);
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  
  // SQL Explorer State
  const [sqlQuery, setSqlQuery] = useState('SELECT id, category, content, importance, created_at FROM memories ORDER BY importance DESC;');
  const [sqlResult, setSqlResult] = useState<{ rows: any[]; rowCount: number; fields?: any[]; error?: string; durationMs?: number } | null>(null);
  const [sqlExecuting, setSqlExecuting] = useState(false);

  // Wake-word & Speech Control
  const [wakeWordEnabled, setWakeWordEnabled] = useState(true);
  const [wakeStatus, setWakeStatus] = useState<string>('Say "June" to converse');
  const speechRecognizer = useRef<any>(null);

  // System Diagnostics
  const [systemMetrics, setSystemMetrics] = useState<SystemStatus | null>(null);
  const [cliCommand, setCliCommand] = useState('');
  const [cliExecuting, setCliExecuting] = useState(false);

  // Autonomous Agents State
  const [agents, setAgents] = useState<SubAgent[]>([
    {
      id: 'agent-sentinel-0',
      name: 'Sentinel',
      role: 'System Security & Diagnostics',
      goal: 'Audit system health, inspect files, and safeguard runtime integrity',
      capabilities: ['Local Terminal Execution', 'Integrity Audit', 'Network Scan'],
      status: 'ready',
      createdAt: new Date(),
      history: []
    }
  ]);
  const [commandInput, setCommandInput] = useState<{ [agentId: string]: string }>({});
  const [agentExecuting, setAgentExecuting] = useState<{ [agentId: string]: boolean }>({});

  const liveService = useRef<LiveService | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => prev === msg ? null : prev);
    }, 3500);
  }, []);

  // Refresh memories from Postgres Lite
  const refreshMemories = useCallback(async () => {
    try {
      const data = await dbService.getMemories({
        category: selectedCategory === 'all' ? undefined : selectedCategory,
        query: memorySearch
      });
      setMemories(data);
    } catch (e) {
      console.warn("Failed to load memories from Postgres Lite:", e);
    }
  }, [selectedCategory, memorySearch]);

  // Load persisted settings and memories from Postgres Lite on initial mount
  useEffect(() => {
    const initApp = async () => {
      try {
        // Load persisted voice from Postgres Lite
        const savedVoice = await dbService.getSetting('voice', 'Aoede');
        if (savedVoice) {
          setSelectedVoice(savedVoice);
        }

        // Load memories from Postgres Lite
        await refreshMemories();

        // Also check API key from Postgres or localStorage
        const dbApiKey = await dbService.getSetting('api_key', '');
        const savedKey = dbApiKey || 
                         localStorage.getItem('JUNE_GEMINI_API_KEY') || 
                         localStorage.getItem('JARVIS_GEMINI_API_KEY') || 
                         localStorage.getItem('gemini_api_key') || 
                         (process.env.API_KEY && process.env.API_KEY !== '""' ? process.env.API_KEY : '');
        if (savedKey && savedKey.trim().length > 0) {
          setApiKey(savedKey);
          setInputKey(savedKey);
          setHasKey(true);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    };

    initApp();
  }, [refreshMemories]);

  // Poll system metrics periodically
  useEffect(() => {
    const fetchMetrics = () => {
      getSystemStatus()
        .then(setSystemMetrics)
        .catch(err => console.warn("Failed to fetch system metrics:", err));
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 6000);
    return () => clearInterval(interval);
  }, []);

  // Initialize or re-configure LiveService when API Key or Voice changes
  useEffect(() => {
    if (!hasKey || !apiKey) return;

    liveService.current = new LiveService(apiKey, selectedVoice);
    liveService.current.onStateChange = setState;
    liveService.current.onVolume = setVolume;
    liveService.current.onMessage = (msg) => {
      setMessages(prev => [msg, ...prev]);
      if (msg.metadata?.image) {
        setActiveMedia(msg);
      }
      // If a memory was saved or modified, refresh memory list
      if (msg.text?.includes('Memory') || msg.text?.includes('Postgres Lite')) {
        refreshMemories();
      }
    };
    
    liveService.current.onConnectionError = (reason: string) => {
      setErrorMessage(reason);
      if (reason.toLowerCase().includes('key') || reason.toLowerCase().includes('1007')) {
        setShowKeyModal(true);
      }
    };

    liveService.current.onAgentCreated = (newAgent: SubAgent) => {
      setAgents(prev => {
        const filtered = prev.filter(a => a.name.toLowerCase() !== newAgent.name.toLowerCase());
        return [newAgent, ...filtered];
      });
      setShowRightDrawer(true);
      setRightTab('agents');
    };

    liveService.current.onAgentUpdated = (updatedAgent: SubAgent) => {
      setAgents(prev => prev.map(a => a.id === updatedAgent.id || a.name.toLowerCase() === updatedAgent.name.toLowerCase() ? updatedAgent : a));
    };

    liveService.current.syncAgents(agents);

    return () => {
      liveService.current?.disconnect();
    };
  }, [hasKey, apiKey, selectedVoice, refreshMemories]);

  // Keep liveService in sync with any agent modifications
  useEffect(() => {
    liveService.current?.syncAgents(agents);
  }, [agents]);

  // Handle changing voice with automatic persistence to Postgres Lite
  const handleVoiceChange = async (voiceId: string) => {
    setSelectedVoice(voiceId);
    try {
      await dbService.setSetting('voice', voiceId);
      if (liveService.current) {
        liveService.current.setVoice(voiceId);
      }
      const match = VOICES.find(v => v.id === voiceId);
      showToast(`Voice set to ${match?.label || voiceId} (Saved in Postgres Lite)`);
    } catch (e) {
      console.error("Failed to save voice to Postgres Lite:", e);
    }
  };

  const handleCameraFrame = useCallback((frame: string) => {
    liveService.current?.updateCameraFrame(frame);
  }, []);

  const handleVisionFrame = useCallback((frame: string) => {
    liveService.current?.updateCameraFrame(frame);
  }, []);

  const handleStartListening = useCallback(() => {
    setErrorMessage(null);
    if (state !== ConnectionState.CONNECTED && state !== ConnectionState.CONNECTING) {
      liveService.current?.connect();
    }
  }, [state]);

  const handleStopListening = useCallback(() => {
    if (state === ConnectionState.CONNECTED || state === ConnectionState.CONNECTING) {
      liveService.current?.disconnect();
    }
  }, [state]);

  const toggleListening = useCallback(() => {
    if (state === ConnectionState.CONNECTED) {
      handleStopListening();
    } else {
      handleStartListening();
    }
  }, [state, handleStartListening, handleStopListening]);

  const handleSendChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    liveService.current?.sendTextMessage(text);
  };

  // Background Speech Recognition for Wake Word ("June" / "Hey June")
  useEffect(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec || !wakeWordEnabled || !hasKey) {
      return;
    }

    // While connected to June, pause browser SpeechRecognition so it doesn't compete for the microphone,
    // trigger duplicate speech synthesis, or cause dual voice overlapping
    if (state === ConnectionState.CONNECTED || state === ConnectionState.CONNECTING) {
      setWakeStatus('Converse naturally with June (Auto-VAD Active)');
      return;
    }

    let isDestroyed = false;
    let rec: any = null;

    try {
      rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          
          if (transcript.includes('june') || transcript.includes('hey june')) {
            setWakeStatus('Wake word "June" recognized');
            if (state !== ConnectionState.CONNECTED && state !== ConnectionState.CONNECTING) {
              handleStartListening();
            }
          }

          if (transcript.includes('that is all') || transcript.includes('stop listening') || transcript.includes('thank you june')) {
            setWakeStatus('Stop directive detected');
            if (state === ConnectionState.CONNECTED) {
              handleStopListening();
            }
          }
        }
      };

      rec.onerror = (e: any) => {
        if (e.error === 'not-allowed') {
          console.warn("Microphone not permitted for speech recognition; auto-wake paused.");
          setWakeWordEnabled(false);
          setWakeStatus('Microphone permission required for Auto-Wake');
          return;
        }
        if (!isDestroyed && e.error !== 'no-speech') {
          console.warn("Speech recognition notice:", e.error);
        }
      };

      rec.onend = () => {
        if (!isDestroyed && wakeWordEnabled) {
          setTimeout(() => {
            if (!isDestroyed && wakeWordEnabled) {
              try {
                rec.start();
              } catch (_) {}
            }
          }, 1000);
        }
      };

      rec.start();
      speechRecognizer.current = rec;
      setWakeStatus('Say "June" to wake • "That is all" to pause');

    } catch (e) {
      console.warn("Speech recognition initialization error:", e);
    }

    return () => {
      isDestroyed = true;
      if (rec) {
        try {
          rec.abort();
        } catch (_) {}
      }
    };
  }, [wakeWordEnabled, hasKey, state, handleStartListening, handleStopListening]);

  const handleSaveKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputKey.trim()) return;

    const trimmed = inputKey.trim();
    localStorage.setItem('JUNE_GEMINI_API_KEY', trimmed);
    localStorage.setItem('JARVIS_GEMINI_API_KEY', trimmed);
    await dbService.setSetting('api_key', trimmed);
    setApiKey(trimmed);
    setHasKey(true);
    setErrorMessage(null);
    setShowKeyModal(false);
    showToast("API Credentials saved");
  };

  // Add a new memory directly into Postgres Lite
  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemoryText.trim()) return;

    try {
      await dbService.addMemory(newMemoryText.trim(), newMemoryCategory, newMemoryImportance);
      setNewMemoryText('');
      setIsAddingMemory(false);
      await refreshMemories();
      showToast("Memory committed to Postgres Lite");
    } catch (err: any) {
      console.error("Failed to add memory:", err);
      showToast("Error adding memory");
    }
  };

  // Delete a memory from Postgres Lite
  const handleDeleteMemory = async (id: number) => {
    try {
      await dbService.deleteMemory(id);
      await refreshMemories();
      showToast("Memory removed from Postgres Lite");
    } catch (err: any) {
      console.error("Failed to delete memory:", err);
    }
  };

  // Execute raw SQL query against Postgres Lite
  const handleExecuteSql = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!sqlQuery.trim()) return;

    setSqlExecuting(true);
    const start = performance.now();
    try {
      const res = await dbService.rawQuery(sqlQuery.trim());
      const duration = Math.round(performance.now() - start);
      setSqlResult({
        rows: res.rows,
        rowCount: res.rowCount,
        fields: res.fields,
        durationMs: duration
      });
      // If a write occurred, refresh memory list
      if (sqlQuery.toLowerCase().includes('insert') || sqlQuery.toLowerCase().includes('delete') || sqlQuery.toLowerCase().includes('update')) {
        refreshMemories();
      }
    } catch (err: any) {
      setSqlResult({
        rows: [],
        rowCount: 0,
        error: err.message || "SQL Execution error",
        durationMs: Math.round(performance.now() - start)
      });
    } finally {
      setSqlExecuting(false);
    }
  };

  const handleExecuteAgentTask = async (agent: SubAgent) => {
    const task = commandInput[agent.id]?.trim();
    if (!task) return;

    // Immediately mark agent as executing with currentTask
    const executingAgent: SubAgent = {
      ...agent,
      status: 'executing',
      currentTask: task,
      startedAt: new Date()
    };
    setAgents(prev => prev.map(a => a.id === agent.id ? executingAgent : a));
    setAgentExecuting(prev => ({ ...prev, [agent.id]: true }));
    setCommandInput(prev => ({ ...prev, [agent.id]: '' }));

    // Emit June's spoken / model announcement in the conversation
    setMessages(prev => [
      {
        id: `dispatch-${Date.now()}`,
        role: 'model',
        text: `Directing agent [${agent.name}] to execute: "${task}". They are now actively analyzing the directive.`,
        timestamp: new Date()
      },
      ...prev
    ]);

    try {
      const visionFrame = liveService.current?.getLatestVisionFrame();
      const res = await executeAgentTask(agent, task, apiKey, visionFrame);
      const updatedHistory = [...(agent.history || []), { prompt: task, result: res.output, timestamp: new Date() }];
      const updatedAgent: SubAgent = {
        ...agent,
        status: 'ready',
        currentTask: undefined,
        lastResult: res.output,
        history: updatedHistory
      };

      setAgents(prev => prev.map(a => a.id === agent.id ? updatedAgent : a));

      setMessages(prev => [
        {
          id: `cmd-report-${Date.now()}`,
          role: 'model',
          text: `Agent ${agent.name} has concluded their directive "${task}". Findings:\n\n${res.output}`,
          timestamp: new Date()
        },
        {
          id: `cmd-${Date.now()}`,
          role: 'system',
          text: `[${agent.name}] Completed task: "${task}"`,
          timestamp: new Date(),
          metadata: {
            type: 'agent_result',
            agent: updatedAgent
          }
        },
        ...prev
      ]);

      // If connected to live session, inform June so she speaks the findings
      if (liveService.current?.isConnected()) {
        try {
          (liveService.current as any).session?.sendRealtimeInput({
            text: `[System Notice for June]: Agent ${agent.name} has finished directive "${task}". Results: "${res.output}". Please verbally inform the user that ${agent.name} has completed their assignment and present an articulate summary of findings.`
          });
        } catch (_) {}
      }
    } finally {
      setAgentExecuting(prev => ({ ...prev, [agent.id]: false }));
    }
  };

  const handleExecuteCli = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cliCommand.trim()) return;

    const cmd = cliCommand.trim();
    setCliExecuting(true);
    try {
      const res = await executeCommand(cmd);
      setMessages(prev => [
        {
          id: `cli-${Date.now()}`,
          role: 'system',
          text: res.stdout || res.stderr || 'Command executed.',
          timestamp: new Date(),
          metadata: {
            type: 'terminal',
            command: cmd,
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode
          }
        },
        ...prev
      ]);
      setCliCommand('');
    } catch (err: any) {
      setMessages(prev => [
        {
          id: `cli-err-${Date.now()}`,
          role: 'system',
          text: `Error: ${err.message}`,
          timestamp: new Date(),
          metadata: { type: 'terminal', command: cmd, stderr: err.message, exitCode: 1 }
        },
        ...prev
      ]);
    } finally {
      setCliExecuting(false);
    }
  };

  const currentVoiceObj = VOICES.find(v => v.id === selectedVoice) || VOICES[0];

  // =========================================================================
  // AUTHENTICATION / API KEY WELCOME VIEW (BESPOKE EDITORIAL MINIMALISM)
  // =========================================================================
  if (!hasKey) {
    return (
      <div className="min-h-screen bg-[#08090c] flex flex-col items-center justify-center relative overflow-hidden text-[#ece9df] p-6">
        {/* Soft atmospheric gradient */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(212,175,119,0.08),transparent)]" />
        
        {/* Center Card */}
        <div className="relative z-10 max-w-lg w-full glass-panel rounded-3xl p-8 sm:p-10 shadow-2xl border border-white/[0.08] flex flex-col items-center text-center">
          
          {/* Presence Emblem */}
          <div className="w-20 h-20 rounded-full bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-6 shadow-inner relative">
            <div className="w-10 h-10 rounded-full bg-[#d4af77]/20 border border-[#d4af77]/40 flex items-center justify-center">
              <span className="font-editorial text-2xl text-[#f3eedd] italic">J</span>
            </div>
            <div className="absolute inset-0 rounded-full animate-ping opacity-15 bg-[#d4af77]" />
          </div>

          <h1 className="font-editorial text-4xl sm:text-5xl text-[#f8f6f0] tracking-tight mb-2">
            June
          </h1>
          <p className="text-xs uppercase tracking-[0.25em] text-[#a5a298] font-medium mb-6">
            Personal Intelligence & Knowledge Architecture
          </p>

          <p className="text-sm text-[#bab7ac] leading-relaxed mb-8 max-w-sm">
            A refined, articulate British companion with persistent memory powered by an embedded Postgres Lite database.
          </p>

          {/* Voice Selector Preview on Onboarding */}
          <div className="w-full text-left mb-6 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-[#a5a298] mb-2 flex items-center justify-between">
              <span>Default Spoken Cadence</span>
              <span className="text-[#d4af77] text-[10px] font-mono-code">PGlite Persisted</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {VOICES.slice(0, 4).map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => handleVoiceChange(v.id)}
                  className={`p-2.5 rounded-xl text-left border text-xs transition-all ${
                    selectedVoice === v.id
                      ? 'bg-[#d4af77]/15 border-[#d4af77]/50 text-[#f5eedc]'
                      : 'bg-white/[0.02] border-white/[0.06] text-[#8e8b82] hover:text-[#e2ded2] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="font-medium flex items-center justify-between">
                    <span>{v.label}</span>
                    {v.recommended && <span className="text-[9px] text-[#d4af77]">★</span>}
                  </div>
                  <div className="text-[10px] text-[#75736c] truncate mt-0.5">{v.accent}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Key Input Form */}
          <form onSubmit={handleSaveKey} className="w-full space-y-4">
            <div className="text-left">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-[#a5a298] mb-2">
                Google Gemini API Key
              </label>
              <input
                type="password"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="AIzaSy..."
                autoFocus
                className="w-full bg-[#111217] border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-[#f5eedc] placeholder-[#57554e] focus:outline-none focus:border-[#d4af77]/60 transition-colors font-mono-code"
              />
            </div>

            <button
              type="submit"
              disabled={!inputKey.trim()}
              className="w-full py-3.5 px-6 rounded-xl bg-[#d4af77] hover:bg-[#dfbc87] text-[#14151a] font-medium text-sm transition-all duration-200 shadow-lg shadow-[#d4af77]/15 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span>Connect to June</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-4 text-xs text-[#75736c]">
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noreferrer" 
              className="hover:text-[#d4af77] flex items-center gap-1 transition-colors"
            >
              <span>Get API key from Google AI Studio</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-[#57554e]">
          Embedded Postgres Lite (PGlite) active • Local-first privacy
        </div>
      </div>
    );
  }

  // =========================================================================
  // MAIN WORKSPACE INTERFACE (ELEGANT EDITORIAL MINIMALISM)
  // =========================================================================
  return (
    <div className="relative w-screen h-screen bg-[#08090c] text-[#ece9df] overflow-hidden select-none">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full glass-panel border border-[#d4af77]/30 text-xs text-[#f5eedc] shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <Check className="w-3.5 h-3.5 text-[#d4af77]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header Navigation */}
      <header className="absolute top-0 left-0 right-0 h-16 z-30 px-6 flex items-center justify-between pointer-events-auto border-b border-white/[0.05] bg-[#08090c]/70 backdrop-blur-md">
        
        {/* Brand & Persona Identity */}
        <div className="flex items-center gap-3.5">
          <div className="flex items-center gap-2">
            <span className="font-editorial text-2xl text-[#f8f6f0] tracking-tight">June</span>
            <span className="text-[10px] uppercase tracking-widest text-[#8c887e] font-medium px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
              Personal Intelligence
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-[#726f66] ml-2 pl-3 border-l border-white/[0.08]">
            <div className={`w-2 h-2 rounded-full ${
              state === ConnectionState.CONNECTED ? 'bg-[#98c379] animate-pulse' :
              state === ConnectionState.CONNECTING ? 'bg-[#e5c07b] animate-spin' : 'bg-[#5c6370]'
            }`} />
            <span className="capitalize">{state.toLowerCase()}</span>
          </div>
        </div>

        {/* Center Pill Quick Actions */}
        <div className="flex items-center gap-2">
          {/* Memory Vault Pill */}
          <button
            onClick={() => {
              setShowLeftDrawer(true);
              setLeftTab('memories');
            }}
            className="px-3 py-1.5 rounded-full bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] text-xs text-[#d2cec3] flex items-center gap-2 transition-colors"
            title="Open Postgres Lite Memory Vault"
          >
            <Database className="w-3.5 h-3.5 text-[#d4af77]" />
            <span className="font-medium">{memories.length}</span>
            <span className="hidden md:inline text-[#8a867c]">Memories in PGlite</span>
          </button>

          {/* Voice Matrix Pill */}
          <button
            onClick={() => setShowKeyModal(true)}
            className="px-3 py-1.5 rounded-full bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] text-xs text-[#d2cec3] flex items-center gap-2 transition-colors"
            title="Voice & Speech Settings"
          >
            <Volume2 className="w-3.5 h-3.5 text-[#a3b18a]" />
            <span className="font-medium">{currentVoiceObj.label}</span>
            <span className="hidden lg:inline text-[#8a867c]">• {currentVoiceObj.accent}</span>
          </button>

          {/* Live Vision / Screen Share Pill */}
          <button
            onClick={() => {
              if (!visionActive) {
                setVisionMode('screen');
                setVisionActive(true);
              } else {
                setVisionActive(false);
              }
            }}
            className={`px-3 py-1.5 rounded-full border text-xs flex items-center gap-2 transition-all ${
              visionActive 
                ? 'bg-[#d4af77]/20 border-[#d4af77]/50 text-[#f5eedc] shadow-lg shadow-[#d4af77]/10' 
                : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-[#d2cec3]'
            }`}
            title={visionActive ? "Click to stop streaming screen" : "Share screen or VS Code window with June"}
          >
            {visionActive ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
                </span>
                <span className="font-medium text-[#f5eedc]">Streaming {visionMode === 'screen' ? 'Screen (VS Code)' : 'Camera'}</span>
              </>
            ) : (
              <>
                <Monitor className="w-3.5 h-3.5 text-[#d4af77]" />
                <span className="font-medium">Share Screen (VS Code)</span>
              </>
            )}
          </button>
        </div>

        {/* Right Telemetry & Drawer Controls */}
        <div className="flex items-center gap-2.5">
          {systemMetrics && (
            <div className="hidden xl:flex items-center gap-3 text-[11px] font-mono-code text-[#7c796f] px-3 py-1 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <span>RAM: {systemMetrics.memUsagePercent}%</span>
              <span>CPU: {systemMetrics.cpuCores}c</span>
              <span>UPTIME: {Math.round(systemMetrics.uptime / 3600)}h</span>
            </div>
          )}

          {/* Drawer Toggle Buttons */}
          <button
            onClick={() => setShowLeftDrawer(!showLeftDrawer)}
            className={`p-2 rounded-xl border transition-all ${
              showLeftDrawer 
                ? 'bg-[#d4af77]/15 border-[#d4af77]/40 text-[#f5eedc]' 
                : 'bg-white/[0.03] border-white/[0.08] text-[#8c887e] hover:text-[#ece9df]'
            }`}
            title="Toggle Memory Vault & Sensors"
          >
            <Database className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowRightDrawer(!showRightDrawer)}
            className={`p-2 rounded-xl border transition-all ${
              showRightDrawer 
                ? 'bg-[#d4af77]/15 border-[#d4af77]/40 text-[#f5eedc]' 
                : 'bg-white/[0.03] border-white/[0.08] text-[#8c887e] hover:text-[#ece9df]'
            }`}
            title="Toggle Workstation & Agents"
          >
            <Layers className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowKeyModal(true)}
            className="p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] text-[#8c887e] hover:text-[#ece9df] transition-colors"
            title="System Settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 max-w-md w-full px-4">
          <div className="p-3 rounded-2xl bg-[#2b1616]/90 border border-red-500/40 text-red-200 text-xs flex items-center justify-between shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2 truncate">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="truncate">{errorMessage}</span>
            </div>
            <button 
              onClick={() => setShowKeyModal(true)}
              className="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 rounded-lg text-[10px] uppercase font-bold text-white transition-colors"
            >
              Resolve
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* CENTERPIECE: FLUID 3D SPHERE & MINIMAL CONVERSATION CORE */}
      {/* ======================================================== */}
      <main className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
        
        {/* June 3D Interactive Presence */}
        <div className="w-[360px] h-[360px] sm:w-[460px] sm:h-[460px] lg:w-[520px] lg:h-[520px] relative pointer-events-auto">
          <JuneOrb3D volume={volume} state={state} onClick={toggleListening} />
          
          {/* Atmosphere radial glow */}
          <div className={`absolute inset-0 rounded-full blur-3xl pointer-events-none transition-all duration-1000 ${
            state === ConnectionState.CONNECTED 
              ? 'bg-[#a3b18a]/12' 
              : state === ConnectionState.CONNECTING 
              ? 'bg-[#e5c07b]/12' 
              : 'bg-[#d4af77]/06'
          }`} />
        </div>

        {/* Center Control Pill */}
        <div className="pointer-events-auto flex flex-col items-center -mt-6 z-20">
          <button
            onClick={toggleListening}
            className={`px-7 py-3 rounded-full text-xs tracking-wider uppercase font-medium transition-all duration-300 shadow-2xl flex items-center gap-3 border backdrop-blur-xl group ${
              state === ConnectionState.CONNECTED 
                ? 'bg-[#1b211a]/80 border-[#a3b18a]/50 text-[#c8d6b4] hover:bg-[#222b20]/90 shadow-[#a3b18a]/10' 
                : state === ConnectionState.CONNECTING 
                ? 'bg-[#292215]/80 border-[#e5c07b]/50 text-[#edd59a] animate-pulse' 
                : 'bg-[#14151b]/80 border-white/[0.12] text-[#e6e2d8] hover:border-[#d4af77]/50 hover:bg-[#1a1b24]'
            }`}
          >
            {state === ConnectionState.CONNECTED ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current text-[#a3b18a]" />
                <span>June is listening • Click or say "That is all"</span>
              </>
            ) : state === ConnectionState.CONNECTING ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-[#e5c07b] border-t-transparent rounded-full animate-spin" />
                <span>Connecting to June...</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-[#d4af77] group-hover:scale-110 transition-transform" />
                <span>Speak to June (Or say "June")</span>
              </>
            )}
          </button>

          {/* Volume wave line */}
          {state === ConnectionState.CONNECTED && (
            <div className="flex items-center gap-1.5 mt-3.5">
              {[...Array(11)].map((_, i) => (
                <div 
                  key={i} 
                  className="w-1 bg-[#d4af77] rounded-full transition-all duration-75"
                  style={{ 
                    height: `${Math.max(4, volume * 90 * (Math.sin(i * 0.7) + 1.2))}px`,
                    opacity: 0.4 + volume * 0.6
                  }}
                />
              ))}
            </div>
          )}

          {/* Wake Word indicator */}
          <div className="mt-3 text-[11px] text-[#78756d] font-mono-code flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4af77]/60" />
            <span>{wakeStatus}</span>
          </div>

          {/* Real-Time Active Agent Execution Indicator & Notification */}
          {agents.some(a => a.status === 'executing') && (
            <div className="mt-4 pointer-events-auto max-w-sm sm:max-w-md w-full px-3">
              {agents.filter(a => a.status === 'executing').map((execAgent) => (
                <div 
                  key={execAgent.id}
                  onClick={() => {
                    setShowRightDrawer(true);
                    setRightTab('agents');
                  }}
                  className="cursor-pointer p-3.5 rounded-2xl bg-[#161410]/95 border border-[#d4af77]/40 hover:border-[#d4af77]/70 shadow-2xl backdrop-blur-2xl transition-all group animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400"></span>
                      </span>
                      <span className="text-xs font-semibold text-[#f5eedc] tracking-wide flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-[#d4af77]" />
                        {execAgent.name}
                      </span>
                      <span className="text-[10px] text-[#9c9688]">({execAgent.role})</span>
                    </div>

                    <span className="text-[9px] font-mono-code uppercase px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                      <div className="w-2 h-2 border border-amber-300 border-t-transparent rounded-full animate-spin" />
                      Working
                    </span>
                  </div>

                  <div className="text-[11px] text-[#dedad0] font-sans line-clamp-2 pl-3 border-l-2 border-[#d4af77]/50 my-1.5">
                    <span className="text-[#a5a092]">Directive: </span>
                    "{execAgent.currentTask || execAgent.goal}"
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#7d7970] pt-1 mt-1 border-t border-white/[0.04]">
                    <span className="flex items-center gap-1 text-[#d4af77]/80 group-hover:text-[#d4af77] font-medium">
                      Inspect agent in drawer →
                    </span>
                    <span className="font-mono-code text-[9px] text-amber-400/70">Autonomous Execution</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* ======================================================== */}
      {/* LEFT DRAWER: JUNE'S MEMORY VAULT (POSTGRES LITE) & SENSORS*/}
      {/* ======================================================== */}
      <div className={`absolute top-20 bottom-24 left-6 z-30 w-84 sm:w-96 rounded-3xl glass-panel p-5 flex flex-col shadow-2xl transition-all duration-400 ${
        showLeftDrawer ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-12 pointer-events-none'
      }`}>
        
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#d4af77]" />
            <span className="font-editorial text-lg text-[#f5eedc]">Memory Vault</span>
            <span className="text-[9px] font-mono-code text-[#a5a298] px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
              PGlite
            </span>
          </div>
          <button 
            onClick={() => setShowLeftDrawer(false)}
            className="text-[#78756d] hover:text-[#ece9df] p-1 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-white/[0.02] border border-white/[0.06] rounded-xl mb-4 text-xs font-medium">
          <button
            onClick={() => setLeftTab('memories')}
            className={`py-1.5 rounded-lg transition-colors ${leftTab === 'memories' ? 'bg-[#d4af77]/20 text-[#f5eedc]' : 'text-[#848177] hover:text-[#dedad0]'}`}
          >
            Memories ({memories.length})
          </button>
          <button
            onClick={() => setLeftTab('sql')}
            className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 ${leftTab === 'sql' ? 'bg-[#d4af77]/20 text-[#f5eedc]' : 'text-[#848177] hover:text-[#dedad0]'}`}
          >
            <Code2 className="w-3 h-3" />
            <span>SQL Console</span>
          </button>
          <button
            onClick={() => setLeftTab('sensors')}
            className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 ${leftTab === 'sensors' ? 'bg-[#d4af77]/20 text-[#f5eedc]' : 'text-[#848177] hover:text-[#dedad0]'}`}
          >
            <Camera className="w-3 h-3" />
            <span>Sensors</span>
          </button>
        </div>

        {/* TAB 1: MEMORIES LIST & SEARCH */}
        {leftTab === 'memories' && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Search and Category Filter */}
            <div className="space-y-2 mb-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#78756d]" />
                <input
                  type="text"
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                  placeholder="Search Postgres Lite memory..."
                  className="w-full bg-[#111217] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-[#ece9df] placeholder-[#65635b] focus:outline-none focus:border-[#d4af77]/50"
                />
              </div>

              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px] no-scrollbar">
                {['all', 'preference', 'fact', 'identity', 'system'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg capitalize whitespace-nowrap transition-colors ${
                      selectedCategory === cat 
                        ? 'bg-[#d4af77]/20 border border-[#d4af77]/40 text-[#f5eedc]' 
                        : 'bg-white/[0.02] border border-white/[0.05] text-[#807d73] hover:text-[#ece9df]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Add Memory Toggle */}
            <div className="mb-3">
              {!isAddingMemory ? (
                <button
                  onClick={() => setIsAddingMemory(true)}
                  className="w-full py-2 px-3 rounded-xl border border-dashed border-white/[0.12] hover:border-[#d4af77]/40 text-xs text-[#9d998f] hover:text-[#f5eedc] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Teach June something new</span>
                </button>
              ) : (
                <form onSubmit={handleAddMemory} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] space-y-2">
                  <textarea
                    value={newMemoryText}
                    onChange={(e) => setNewMemoryText(e.target.value)}
                    placeholder="Enter fact, preference, or context for June to remember..."
                    rows={2}
                    className="w-full bg-[#111217] border border-white/[0.08] rounded-lg p-2 text-xs text-[#ece9df] placeholder-[#65635b] focus:outline-none focus:border-[#d4af77]/50 resize-none"
                    autoFocus
                  />
                  <div className="flex items-center justify-between gap-2">
                    <select
                      value={newMemoryCategory}
                      onChange={(e) => setNewMemoryCategory(e.target.value)}
                      className="bg-[#111217] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-[#c2beb2] focus:outline-none"
                    >
                      <option value="preference">Preference</option>
                      <option value="fact">Fact</option>
                      <option value="project">Project</option>
                      <option value="personal">Personal</option>
                    </select>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsAddingMemory(false)}
                        className="px-2.5 py-1 text-[11px] text-[#807d73] hover:text-[#ece9df]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!newMemoryText.trim()}
                        className="px-3 py-1 rounded-lg bg-[#d4af77] text-[#14151a] font-medium text-[11px] hover:bg-[#e0be89] disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>

            {/* Memories List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {memories.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#706d64]">
                  No memories found in Postgres Lite database.
                </div>
              ) : (
                memories.map((m) => (
                  <div 
                    key={m.id}
                    className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.1] transition-all group relative"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-mono-code uppercase px-2 py-0.5 rounded bg-[#d4af77]/10 text-[#d4af77] border border-[#d4af77]/20">
                        {m.category}
                      </span>
                      <button
                        onClick={() => handleDeleteMemory(m.id)}
                        className="opacity-0 group-hover:opacity-100 text-[#7a776e] hover:text-red-400 p-1 transition-opacity"
                        title="Delete memory"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-[#dcd8cb] leading-relaxed">
                      {m.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 2: INTERACTIVE SQL CONSOLE FOR POSTGRES LITE */}
        {leftTab === 'sql' && (
          <div className="flex-1 flex flex-col min-h-0 space-y-3">
            <div className="text-[11px] text-[#8c887e]">
              Direct query interface to embedded <span className="font-mono-code text-[#d4af77]">Postgres Lite</span> (WASM).
            </div>

            {/* Quick Queries */}
            <div className="flex flex-wrap gap-1 text-[10px] font-mono-code">
              <button 
                onClick={() => setSqlQuery('SELECT * FROM memories;')}
                className="px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] text-[#c2beb2]"
              >
                SELECT * FROM memories
              </button>
              <button 
                onClick={() => setSqlQuery('SELECT * FROM settings;')}
                className="px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] text-[#c2beb2]"
              >
                SELECT * FROM settings
              </button>
              <button 
                onClick={() => setSqlQuery('SELECT * FROM conversation_log ORDER BY created_at DESC LIMIT 5;')}
                className="px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.08] text-[#c2beb2]"
              >
                conversation_log
              </button>
            </div>

            {/* Query Editor */}
            <form onSubmit={handleExecuteSql} className="space-y-2">
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                rows={3}
                className="w-full bg-[#111217] border border-white/[0.08] rounded-xl p-2.5 text-xs font-mono-code text-[#f5eedc] focus:outline-none focus:border-[#d4af77]/50 resize-none"
              />
              <button
                type="submit"
                disabled={sqlExecuting}
                className="w-full py-2 rounded-xl bg-[#d4af77] hover:bg-[#e0be89] text-[#14151a] font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{sqlExecuting ? 'Executing in PGlite...' : 'Run SQL Query'}</span>
              </button>
            </form>

            {/* Query Output View */}
            <div className="flex-1 overflow-auto bg-[#111217] rounded-xl border border-white/[0.06] p-2 text-xs font-mono-code">
              {sqlResult?.error ? (
                <div className="text-red-400 p-2">Error: {sqlResult.error}</div>
              ) : sqlResult ? (
                <div>
                  <div className="text-[10px] text-[#78756d] mb-1.5 border-b border-white/[0.06] pb-1 flex justify-between">
                    <span>{sqlResult.rowCount} rows returned</span>
                    <span>{sqlResult.durationMs}ms</span>
                  </div>
                  <pre className="text-[10px] text-[#c8d6b4] whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(sqlResult.rows, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="text-[#65635b] p-2 text-center">Run a query to inspect the database.</div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: OPTICAL SENSORS & VISION */}
        {leftTab === 'sensors' && (
          <div className="flex-1 flex flex-col space-y-3 overflow-y-auto pr-1">
            {/* Vision Mode Selector & Toggle */}
            <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#f5eedc] flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#d4af77]" />
                    <span>Real-Time Vision Stream</span>
                  </div>
                  <div className="text-[10px] text-[#8c887e]">
                    Stream screen or camera to June & autonomous agents
                  </div>
                </div>

                <button
                  onClick={() => setVisionActive(!visionActive)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                    visionActive 
                      ? 'bg-red-950/40 border-red-500/40 text-red-300' 
                      : 'bg-[#d4af77]/20 border-[#d4af77]/40 text-[#f5eedc]'
                  }`}
                >
                  {visionActive ? 'Stop Stream' : 'Start Stream'}
                </button>
              </div>

              {/* Mode Toggle Buttons */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/[0.06] text-xs">
                <button
                  onClick={() => setVisionMode('screen')}
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                    visionMode === 'screen' ? 'bg-[#d4af77]/20 text-[#f5eedc] font-medium' : 'text-[#848177] hover:text-[#dedad0]'
                  }`}
                >
                  <Monitor className="w-3 h-3" />
                  <span>Screen (VS Code)</span>
                </button>
                <button
                  onClick={() => setVisionMode('camera')}
                  className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
                    visionMode === 'camera' ? 'bg-[#d4af77]/20 text-[#f5eedc] font-medium' : 'text-[#848177] hover:text-[#dedad0]'
                  }`}
                >
                  <Camera className="w-3 h-3" />
                  <span>Optical Camera</span>
                </button>
              </div>

              {visionActive && (
                <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between text-[11px] text-emerald-300">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    June & Agents are live seeing your {visionMode === 'screen' ? 'screen' : 'camera'}
                  </span>
                  <span className="font-mono-code text-[10px]">2 FPS • 1080p</span>
                </div>
              )}
            </div>

            {/* Quick Hands-Free Coding Shortcuts */}
            <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-2">
              <div className="text-xs font-semibold text-[#f5eedc] flex items-center gap-1.5">
                <FolderCode className="w-3.5 h-3.5 text-[#d4af77]" />
                <span>Hands-Free VS Code Workstation</span>
              </div>
              <p className="text-[10px] text-[#8c887e] leading-relaxed">
                June can inspect code on your screen, open files at exact lines, and deploy agents to debug or refactor.
              </p>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={async () => {
                    try {
                      await openInVSCode({ path: '.' });
                      showToast("Opened project in VS Code");
                    } catch (e: any) {
                      showToast(`VS Code: ${e.message}`);
                    }
                  }}
                  className="p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-left text-xs text-[#d2cec3] transition-colors"
                >
                  <div className="font-medium text-[#f5eedc]">Open VS Code</div>
                  <div className="text-[9px] text-[#78756d]">Open current workspace</div>
                </button>

                <button
                  onClick={() => {
                    if (liveService.current?.isConnected()) {
                      (liveService.current as any).session?.sendRealtimeInput({
                        text: "June, please visually inspect what is currently on my screen and tell me what you see."
                      });
                      showToast("Requested June to inspect screen");
                    } else {
                      showToast("Connect to June first");
                    }
                  }}
                  className="p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] text-left text-xs text-[#d2cec3] transition-colors"
                >
                  <div className="font-medium text-[#f5eedc]">Analyze Screen</div>
                  <div className="text-[9px] text-[#78756d]">Ask June to read screen</div>
                </button>
              </div>
            </div>

            {activeMedia?.metadata?.image && (
              <div className="rounded-xl overflow-hidden border border-[#d4af77]/30 max-h-40 relative">
                <img src={activeMedia.metadata.image} alt="Visual Output" className="w-full h-auto object-cover" />
                <div className="absolute bottom-1 right-1 text-[9px] font-mono-code bg-black/80 px-2 py-0.5 rounded text-[#d4af77]">
                  Rendered
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* RIGHT DRAWER: WORKSTATION, AGENTS & TRANSCRIPT           */}
      {/* ======================================================== */}
      <div className={`absolute top-20 bottom-24 right-6 z-30 w-84 sm:w-96 rounded-3xl glass-panel p-5 flex flex-col shadow-2xl transition-all duration-400 ${
        showRightDrawer ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-12 pointer-events-none'
      }`}>
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="font-editorial text-lg text-[#f5eedc]">Workstation & Agents</span>
          </div>
          <button 
            onClick={() => setShowRightDrawer(false)}
            className="text-[#78756d] hover:text-[#ece9df] p-1 rounded-lg transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-white/[0.02] border border-white/[0.06] rounded-xl mb-4 text-xs font-medium">
          <button
            onClick={() => setRightTab('agents')}
            className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${rightTab === 'agents' ? 'bg-[#d4af77]/20 text-[#f5eedc]' : 'text-[#848177] hover:text-[#dedad0]'}`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Agents ({agents.length})</span>
          </button>
          <button
            onClick={() => setRightTab('terminal')}
            className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${rightTab === 'terminal' ? 'bg-[#d4af77]/20 text-[#f5eedc]' : 'text-[#848177] hover:text-[#dedad0]'}`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>
          <button
            onClick={() => setRightTab('activity')}
            className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${rightTab === 'activity' ? 'bg-[#d4af77]/20 text-[#f5eedc]' : 'text-[#848177] hover:text-[#dedad0]'}`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Activity</span>
          </button>
        </div>

        {/* TAB 1: AUTONOMOUS AGENTS */}
        {rightTab === 'agents' && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {agents.map((agent) => (
              <div 
                key={agent.id}
                className={`p-4 rounded-2xl transition-all space-y-2.5 ${
                  agent.status === 'executing' 
                    ? 'bg-[#181510]/85 border border-[#d4af77]/40 shadow-lg' 
                    : 'bg-white/[0.02] border border-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-[#f5eedc] flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-[#d4af77]" />
                      {agent.name}
                    </h4>
                    <p className="text-[10px] text-[#8c887e]">{agent.role}</p>
                  </div>
                  <span className={`text-[9px] font-mono-code uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${
                    agent.status === 'executing' 
                      ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30' 
                      : 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    {agent.status === 'executing' && (
                      <div className="w-2 h-2 border border-amber-300 border-t-transparent rounded-full animate-spin" />
                    )}
                    {agent.status}
                  </span>
                </div>

                <p className="text-[11px] text-[#bab6aa] leading-relaxed">
                  {agent.goal}
                </p>

                {/* Active Directive Working Indicator */}
                {agent.status === 'executing' && (
                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
                        Actively Working on Directive:
                      </span>
                      <span className="text-[9px] font-mono-code text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                        EXECUTING
                      </span>
                    </div>
                    <p className="text-xs text-[#f5eedc] font-sans italic pl-2.5 border-l-2 border-amber-400/50 leading-relaxed">
                      "{agent.currentTask || agent.goal}"
                    </p>
                    <p className="text-[10px] text-[#a5a092]">
                      Synthesizing intelligence and executing task operations...
                    </p>
                  </div>
                )}

                {/* Completed Report Callout */}
                {agent.lastResult && agent.status !== 'executing' && (
                  <div className="rounded-xl bg-[#111217] border border-white/[0.08] overflow-hidden">
                    <div className="flex items-center justify-between px-2.5 py-1.5 bg-white/[0.02] border-b border-white/[0.05] text-[10px]">
                      <span className="font-mono-code text-[#a5a298] flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-400" />
                        Latest Intelligence Report
                      </span>
                      <span className="text-[9px] text-[#78756d]">Concluded</span>
                    </div>
                    <div className="p-2.5 text-[11px] text-[#cfcbbe] max-h-36 overflow-y-auto font-mono-code whitespace-pre-wrap leading-relaxed">
                      {agent.lastResult}
                    </div>
                  </div>
                )}

                {/* Directive Command Input */}
                <div className="flex items-center gap-1.5 pt-1">
                  <input
                    type="text"
                    value={commandInput[agent.id] || ''}
                    onChange={(e) => setCommandInput(prev => ({ ...prev, [agent.id]: e.target.value }))}
                    placeholder={agent.status === 'executing' ? `${agent.name} is currently working...` : `Dispatch directive to ${agent.name}...`}
                    disabled={agent.status === 'executing' || agentExecuting[agent.id]}
                    className="flex-1 bg-[#111217] border border-white/[0.08] rounded-xl px-2.5 py-1.5 text-xs text-[#ece9df] placeholder-[#65635b] focus:outline-none disabled:opacity-40"
                    onKeyDown={(e) => e.key === 'Enter' && handleExecuteAgentTask(agent)}
                  />
                  <button
                    onClick={() => handleExecuteAgentTask(agent)}
                    disabled={agent.status === 'executing' || agentExecuting[agent.id] || !commandInput[agent.id]?.trim()}
                    className="p-1.5 rounded-xl bg-[#d4af77] hover:bg-[#e0be89] text-[#14151a] disabled:opacity-40 transition-colors flex items-center justify-center min-w-[32px]"
                  >
                    {agent.status === 'executing' || agentExecuting[agent.id] ? (
                      <div className="w-3.5 h-3.5 border-2 border-[#14151a] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 2: TERMINAL CONSOLE */}
        {rightTab === 'terminal' && (
          <div className="flex-1 flex flex-col space-y-3 min-h-0">
            <div className="text-[11px] text-[#8c887e]">
              Direct execution bridge to user's workstation.
            </div>

            <form onSubmit={handleExecuteCli} className="flex gap-1.5">
              <input
                type="text"
                value={cliCommand}
                onChange={(e) => setCliCommand(e.target.value)}
                placeholder="git status, ls -la, uname -a..."
                className="flex-1 bg-[#111217] border border-white/[0.08] rounded-xl px-3 py-2 text-xs font-mono-code text-[#ece9df] placeholder-[#65635b] focus:outline-none focus:border-[#d4af77]/50"
              />
              <button
                type="submit"
                disabled={cliExecuting || !cliCommand.trim()}
                className="px-3.5 py-2 rounded-xl bg-[#d4af77] hover:bg-[#e0be89] text-[#14151a] font-medium text-xs disabled:opacity-40 transition-colors"
              >
                Run
              </button>
            </form>

            <div className="flex-1 overflow-y-auto bg-[#111217] rounded-xl p-3 border border-white/[0.06] text-[11px] font-mono-code space-y-2">
              {messages.filter(m => m.metadata?.type === 'terminal').length === 0 ? (
                <div className="text-[#65635b] text-center py-8">
                  Terminal execution logs will appear here.
                </div>
              ) : (
                messages
                  .filter(m => m.metadata?.type === 'terminal')
                  .map(m => (
                    <div key={m.id} className="space-y-1 border-b border-white/[0.04] pb-2">
                      <div className="text-[#d4af77] flex items-center gap-1">
                        <span>$</span>
                        <span>{m.metadata?.command}</span>
                      </div>
                      <pre className="text-[#bab6aa] whitespace-pre-wrap overflow-x-auto text-[10px]">
                        {m.metadata?.stdout || m.metadata?.stderr || m.text}
                      </pre>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: ACTIVITY FEED */}
        {rightTab === 'activity' && (
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {messages.length === 0 ? (
              <div className="text-center py-10 text-xs text-[#706d64]">
                Session activity log is empty.
              </div>
            ) : (
              messages.map(m => (
                <div 
                  key={m.id}
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    m.role === 'model' 
                      ? 'bg-[#d4af77]/06 border-[#d4af77]/20 text-[#f5eedc]'
                      : m.role === 'user' 
                      ? 'bg-white/[0.03] border-white/[0.08] text-[#e0ded6]'
                      : 'bg-white/[0.01] border-white/[0.04] text-[#8e8b82]'
                  }`}
                >
                  <div className="text-[10px] font-mono-code text-[#7c796f] uppercase mb-1 flex items-center justify-between">
                    <span>{m.role === 'model' ? 'June' : m.role}</span>
                    <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.metadata?.sources && m.metadata.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/[0.06] flex flex-wrap gap-1.5">
                      {m.metadata.sources.map((s, idx) => (
                        <a 
                          key={idx} 
                          href={s.uri} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-[10px] text-[#d4af77] hover:underline bg-[#d4af77]/10 px-2 py-0.5 rounded flex items-center gap-1 max-w-[260px] truncate"
                        >
                          <span className="truncate">{s.title || s.uri}</span>
                          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

      </div>

      {/* ======================================================== */}
      {/* BOTTOM CONTROL DOCK: CLEAN INPUT, VOICE SELECTOR, MIC    */}
      {/* ======================================================== */}
      <footer className="absolute bottom-6 left-0 right-0 z-30 px-6 flex items-center justify-center pointer-events-auto">
        <div className="max-w-2xl w-full glass-panel rounded-2xl p-2 border border-white/[0.08] shadow-2xl flex items-center gap-2">
          
          {/* Quick Voice Switcher Dropdown (1-Click Persist to Postgres Lite) */}
          <div className="relative">
            <select
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className="bg-[#111217] hover:bg-[#181920] border border-white/[0.08] rounded-xl px-2.5 py-2 text-xs text-[#d2cec3] font-medium focus:outline-none focus:border-[#d4af77]/50 transition-colors cursor-pointer appearance-none pr-7"
              title="Voice selection automatically persists in Postgres Lite"
            >
              {VOICES.map(v => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.accent})
                </option>
              ))}
            </select>
            <ChevronRight className="w-3.5 h-3.5 rotate-90 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[#7c796f]" />
          </div>

          {/* Text Input Form */}
          <form onSubmit={handleSendChat} className="flex-1 flex items-center">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask June anything or type a system directive..."
              className="w-full bg-transparent px-3 py-2 text-xs text-[#ece9df] placeholder-[#65635b] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[#a5a298] hover:text-[#f5eedc] disabled:opacity-30 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          {/* Quick Mic Action */}
          <button
            onClick={toggleListening}
            className={`p-2.5 rounded-xl border transition-all ${
              state === ConnectionState.CONNECTED 
                ? 'bg-red-950/60 border-red-500/50 text-red-300' 
                : 'bg-[#d4af77] hover:bg-[#e0be89] text-[#14151a]'
            }`}
            title={state === ConnectionState.CONNECTED ? "Mute June" : "Start Live Voice"}
          >
            {state === ConnectionState.CONNECTED ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
        </div>
      </footer>

      {/* ======================================================== */}
      {/* SYSTEM CONFIGURATION & VOICE MATRIX MODAL                */}
      {/* ======================================================== */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel border border-white/[0.1] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-editorial text-2xl text-[#f8f6f0]">System & Voice Matrix</h3>
              <button 
                onClick={() => setShowKeyModal(false)}
                className="text-[#78756d] hover:text-[#ece9df] p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[#8c887e] mb-6">
              Configure June's voice cadence and Google Gemini API credentials. All settings are persistently preserved in <span className="font-mono-code text-[#d4af77]">Postgres Lite (PGlite)</span>.
            </p>

            {/* Voice Matrix Selection */}
            <div className="mb-6 space-y-2">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-[#a5a298] flex items-center justify-between">
                <span>Select Voice Persona</span>
                <span className="text-[10px] text-[#d4af77] font-mono-code">PGlite Stored</span>
              </label>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handleVoiceChange(v.id)}
                    className={`w-full p-3 rounded-2xl text-left border transition-all flex items-start justify-between ${
                      selectedVoice === v.id
                        ? 'bg-[#d4af77]/15 border-[#d4af77]/60 text-[#f5eedc]'
                        : 'bg-white/[0.02] border-white/[0.06] text-[#8e8b82] hover:bg-white/[0.04] hover:text-[#e2ded2]'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-medium flex items-center gap-1.5">
                        <span>{v.label}</span>
                        {v.recommended && (
                          <span className="text-[9px] bg-[#d4af77]/20 text-[#d4af77] px-1.5 py-0.2 rounded border border-[#d4af77]/30">
                            Recommended for June
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#7c796f] mt-0.5 leading-relaxed">
                        {v.desc}
                      </div>
                    </div>
                    {selectedVoice === v.id && (
                      <Check className="w-4 h-4 text-[#d4af77] flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* API Key Configuration */}
            <form onSubmit={handleSaveKey} className="space-y-4 pt-4 border-t border-white/[0.08]">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-[#a5a298] mb-1.5">
                  Update Gemini API Key
                </label>
                <input
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-[#111217] border border-white/[0.1] rounded-xl px-4 py-2.5 text-xs text-[#f5eedc] placeholder-[#57554e] focus:outline-none focus:border-[#d4af77]/50 font-mono-code"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2 text-xs text-[#8c887e] hover:text-[#ece9df] transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={!inputKey.trim()}
                  className="px-5 py-2 rounded-xl bg-[#d4af77] hover:bg-[#e0be89] text-[#14151a] font-medium text-xs transition-colors disabled:opacity-40"
                >
                  Save Credentials
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* Global Vision Sensor (Screen Share / Optical Camera Stream) */}
      <VisionSensor
        active={visionActive}
        mode={visionMode}
        onFrame={handleVisionFrame}
        onToggle={setVisionActive}
        onModeChange={setVisionMode}
      />

    </div>
  );
}
