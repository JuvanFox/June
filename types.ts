export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SubAgent {
  id: string;
  name: string;
  role: string;
  goal: string;
  capabilities: string[];
  instructions?: string;
  status: 'idle' | 'executing' | 'ready';
  currentTask?: string;
  startedAt?: Date | string;
  createdAt: Date;
  lastResult?: string;
  history: { prompt: string; result: string; timestamp: Date }[];
}

export interface MessageLog {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: Date;
  metadata?: {
    image?: string;
    sources?: GroundingSource[];
    type?: 'search' | 'image_gen' | 'reimagine' | 'agent_created' | 'agent_result' | 'terminal' | 'system_status' | 'text';
    agent?: SubAgent;
    command?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  };
}

export interface AudioConfig {
  sampleRate: number;
}

export interface MemoryItem {
  id: number;
  category: 'preference' | 'fact' | 'project' | 'personal' | 'system' | string;
  content: string;
  importance: number;
  tags?: string[];
  created_at: string | Date;
  updated_at: string | Date;
}

export interface VoiceOption {
  id: string;
  label: string;
  desc: string;
  gender: 'female' | 'male';
  accent: string;
  recommended?: boolean;
}

export interface JuneSettings {
  voice: string;
  assistant_name: string;
  wake_word: string;
  speech_rate?: string;
  theme_accent?: string;
}
