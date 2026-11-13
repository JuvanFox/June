import { PGlite } from '@electric-sql/pglite';
import { MemoryItem, JuneSettings } from '../types';

class DatabaseService {
  private db: PGlite | null = null;
  private initPromise: Promise<PGlite> | null = null;

  public async getDb(): Promise<PGlite> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Attempt persistent IndexedDB storage
        const instance = new PGlite('idb://june_knowledge_vault');
        await instance.waitReady;
        this.db = instance;
        await this.bootstrapTables(instance);
        return instance;
      } catch (err) {
        console.warn('PGlite IndexedDB init failed, falling back to in-memory Postgres Lite:', err);
        const fallback = new PGlite();
        await fallback.waitReady;
        this.db = fallback;
        await this.bootstrapTables(fallback);
        return fallback;
      }
    })();

    return this.initPromise;
  }

  private async bootstrapTables(db: PGlite) {
    // 1. Settings Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Memories Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS memories (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        importance INT DEFAULT 1,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Conversation & Audit Logs
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversation_log (
        id SERIAL PRIMARY KEY,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Performance Indexes for Lifelong Memory Search
    await db.query(`CREATE INDEX IF NOT EXISTS idx_conversation_created ON conversation_log(created_at DESC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC, updated_at DESC);`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);`);

    // Seed default settings if not already present
    const defaultVoice = 'Aoede'; // British mature woman
    await db.query(`
      INSERT INTO settings (key, value)
      VALUES 
        ('voice', $1),
        ('assistant_name', 'June'),
        ('wake_word', 'June'),
        ('speech_rate', '1.0'),
        ('accent_desc', 'British mature woman - cultured, articulate & composed')
      ON CONFLICT (key) DO NOTHING;
    `, [defaultVoice]);

    // Check if initial memories exist, if not seed baseline knowledge
    const existing = await db.query(`SELECT COUNT(*) as count FROM memories;`);
    const count = parseInt((existing.rows[0] as any)?.count || '0', 10);
    if (count === 0) {
      const initialMemories = [
        {
          category: 'identity',
          content: 'My name is June. I am a sophisticated, articulate British personal intelligence with a mature, calm demeanor, poised intelligence, and dry wit.',
          importance: 3,
          tags: ['identity', 'persona']
        },
        {
          category: 'preference',
          content: 'The user values a clean, modern aesthetic devoid of AI clichés, robotic jargon, and generic cyber tropes.',
          importance: 3,
          tags: ['ui', 'user_preference']
        },
        {
          category: 'preference',
          content: 'Voice and spoken communications must maintain a refined, mature British cadence. Voice preferences must persist across all sessions.',
          importance: 2,
          tags: ['voice', 'speech']
        },
        {
          category: 'system',
          content: 'June is powered by an embedded Postgres Lite (PGlite) instance running in WebAssembly with persistent storage, giving her genuine long-term memory.',
          importance: 2,
          tags: ['architecture', 'pglite']
        }
      ];

      for (const mem of initialMemories) {
        await db.query(
          `INSERT INTO memories (category, content, importance, tags) VALUES ($1, $2, $3, $4);`,
          [mem.category, mem.content, mem.importance, mem.tags]
        );
      }
    }
  }

  // --- Settings APIs ---
  public async getSetting(key: string, fallback: string = ''): Promise<string> {
    try {
      const db = await this.getDb();
      const res = await db.query(`SELECT value FROM settings WHERE key = $1;`, [key]);
      if (res.rows.length > 0) {
        return (res.rows[0] as any).value;
      }
      return fallback;
    } catch (e) {
      console.error(`Failed to get setting ${key}:`, e);
      return fallback;
    }
  }

  public async setSetting(key: string, value: string): Promise<void> {
    try {
      const db = await this.getDb();
      await db.query(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE 
        SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
      `, [key, value]);
    } catch (e) {
      console.error(`Failed to set setting ${key}:`, e);
    }
  }

  public async getAllSettings(): Promise<JuneSettings> {
    try {
      const db = await this.getDb();
      const res = await db.query(`SELECT key, value FROM settings;`);
      const map: Record<string, string> = {};
      for (const row of res.rows as any[]) {
        map[row.key] = row.value;
      }
      return {
        voice: map['voice'] || 'Aoede',
        assistant_name: map['assistant_name'] || 'June',
        wake_word: map['wake_word'] || 'June',
        speech_rate: map['speech_rate'] || '1.0',
        theme_accent: map['theme_accent'] || 'champagne'
      };
    } catch (e) {
      console.error('Failed to get all settings:', e);
      return {
        voice: 'Aoede',
        assistant_name: 'June',
        wake_word: 'June'
      };
    }
  }

  // --- Memory APIs ---
  public async addMemory(
    content: string, 
    category: string = 'fact', 
    importance: number = 1,
    tags: string[] = []
  ): Promise<MemoryItem> {
    const db = await this.getDb();
    const res = await db.query(`
      INSERT INTO memories (category, content, importance, tags, created_at, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `, [category, content.trim(), importance, tags]);
    
    return res.rows[0] as unknown as MemoryItem;
  }

  public async getMemories(filter?: { category?: string; query?: string }): Promise<MemoryItem[]> {
    try {
      const db = await this.getDb();
      let sql = `SELECT * FROM memories`;
      const params: any[] = [];
      const conditions: string[] = [];

      if (filter?.category && filter.category !== 'all') {
        params.push(filter.category);
        conditions.push(`category = $${params.length}`);
      }

      if (filter?.query && filter.query.trim()) {
        params.push(`%${filter.query.trim()}%`);
        conditions.push(`content ILIKE $${params.length}`);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ` + conditions.join(' AND ');
      }

      sql += ` ORDER BY importance DESC, updated_at DESC;`;

      const res = await db.query(sql, params);
      return res.rows as unknown as MemoryItem[];
    } catch (e) {
      console.error('Failed to get memories:', e);
      return [];
    }
  }

  public async updateMemory(id: number, content: string, category?: string): Promise<void> {
    const db = await this.getDb();
    if (category) {
      await db.query(`
        UPDATE memories 
        SET content = $1, category = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $3;
      `, [content.trim(), category, id]);
    } else {
      await db.query(`
        UPDATE memories 
        SET content = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $2;
      `, [content.trim(), id]);
    }
  }

  public async deleteMemory(id: number): Promise<void> {
    const db = await this.getDb();
    await db.query(`DELETE FROM memories WHERE id = $1;`, [id]);
  }

  public async clearMemories(): Promise<void> {
    const db = await this.getDb();
    await db.query(`DELETE FROM memories;`);
  }

  /**
   * Generates a comprehensive summary of June's persistent memories and recent
   * cross-session interactions to feed directly into the systemInstruction prompt.
   */
  public async getMemoriesSummaryForPrompt(): Promise<string> {
    try {
      const db = await this.getDb();

      // 1. Get high-importance memories
      const memoriesRes = await db.query(`
        SELECT category, content, importance 
        FROM memories 
        ORDER BY importance DESC, updated_at DESC 
        LIMIT 35;
      `);

      // 2. Get recent past interactions across all sessions
      const recentTurnsRes = await db.query(`
        SELECT role, content, created_at 
        FROM conversation_log 
        ORDER BY created_at DESC 
        LIMIT 10;
      `);

      const memoryLines = memoriesRes.rows.map(
        (m: any) => `- [${m.category.toUpperCase()}] ${m.content}`
      );

      // Reverse recent turns so they appear in chronological order
      const chronologicalTurns = [...recentTurnsRes.rows].reverse();
      const dialogueLines = chronologicalTurns.map(
        (t: any) => {
          const time = new Date(t.created_at).toLocaleString('en-GB', {
            hour12: false,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          const speaker = t.role === 'user' ? 'User' : 'June';
          const truncated = t.content.length > 250 ? t.content.slice(0, 247) + '...' : t.content;
          return `[${time}] ${speaker}: ${truncated}`;
        }
      );

      let result = `\n\n=== JUNE'S LIFELONG KNOWLEDGE & MEMORY VAULT (Persisted in Postgres Lite) ===\n`;

      if (memoryLines.length > 0) {
        result += `[CORE KNOWLEDGE & ENDURING FACTS]:\n${memoryLines.join('\n')}\n\n`;
      }

      if (dialogueLines.length > 0) {
        result += `[RECENT PAST LIFELONG INTERACTIONS (Across Sessions)]:\n${dialogueLines.join('\n')}\n\n`;
      }

      result += `PERMANENT MEMORY DIRECTIVE:
You have genuine lifelong recall powered by Postgres Lite. Every question the user has ever asked, every task executed, and every preference shared is permanently cataloged.
Use this context seamlessly: you do not need to ask the user to repeat themselves, you know their previous projects, tools, and discussions.
If asked to recall specific past sessions, past questions, or historical details, invoke 'recall_lifelong_memory'.`;

      return result;
    } catch (e) {
      console.error('Failed to build lifelong memory prompt summary:', e);
      return '';
    }
  }

  // --- Interaction Logging ---
  public async saveInteraction(role: string, content: string, metadata?: any): Promise<void> {
    try {
      const db = await this.getDb();
      await db.query(`
        INSERT INTO conversation_log (role, content, metadata, created_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP);
      `, [role, content, metadata ? JSON.stringify(metadata) : null]);
    } catch (e) {
      console.error('Failed to save interaction:', e);
    }
  }

  public async getRecentInteractions(limit: number = 30): Promise<any[]> {
    try {
      const db = await this.getDb();
      const res = await db.query(`
        SELECT * FROM conversation_log 
        ORDER BY created_at DESC 
        LIMIT $1;
      `, [limit]);
      return res.rows;
    } catch (e) {
      console.error('Failed to get recent interactions:', e);
      return [];
    }
  }

  public async getConversationHistory(limit: number = 50, offset: number = 0, query?: string): Promise<any[]> {
    try {
      const db = await this.getDb();
      if (query && query.trim()) {
        const res = await db.query(`
          SELECT * FROM conversation_log 
          WHERE content ILIKE $1 
          ORDER BY created_at DESC 
          LIMIT $2 OFFSET $3;
        `, [`%${query.trim()}%`, limit, offset]);
        return res.rows;
      } else {
        const res = await db.query(`
          SELECT * FROM conversation_log 
          ORDER BY created_at DESC 
          LIMIT $1 OFFSET $2;
        `, [limit, offset]);
        return res.rows;
      }
    } catch (e) {
      console.error('Failed to get conversation history:', e);
      return [];
    }
  }

  /**
   * Deep search across June's entire lifetime knowledge vault:
   * both core knowledge nodes (memories) and past conversation dialogues (conversation_log).
   */
  public async searchLifetimeHistory(query: string, limit: number = 15): Promise<{
    memories: MemoryItem[];
    conversations: { id: number; role: string; content: string; created_at: string }[];
    totalMatches: number;
  }> {
    try {
      const db = await this.getDb();
      const cleanQuery = `%${query.trim()}%`;

      // 1. Search memories table
      const memRes = await db.query(`
        SELECT * FROM memories 
        WHERE content ILIKE $1 OR category ILIKE $1
        ORDER BY importance DESC, updated_at DESC
        LIMIT $2;
      `, [cleanQuery, limit]);

      // 2. Search conversation_log table
      const convRes = await db.query(`
        SELECT id, role, content, created_at 
        FROM conversation_log
        WHERE content ILIKE $1
        ORDER BY created_at DESC
        LIMIT $2;
      `, [cleanQuery, limit]);

      const memories = memRes.rows as unknown as MemoryItem[];
      const conversations = convRes.rows as any[];

      return {
        memories,
        conversations,
        totalMatches: memories.length + conversations.length
      };
    } catch (e) {
      console.error("Failed to search lifetime history:", e);
      return { memories: [], conversations: [], totalMatches: 0 };
    }
  }

  /**
   * Automatically analyzes an exchange between user and June to extract
   * enduring preferences, project details, tech stacks, or standing rules
   * and saves them permanently into Postgres Lite.
   */
  public async autoExtractLifelongMemories(userInput: string, modelResponse: string, apiKey?: string): Promise<MemoryItem[]> {
    const key = apiKey ||
      (typeof window !== 'undefined' ? (localStorage.getItem('JUNE_GEMINI_API_KEY') || localStorage.getItem('JARVIS_GEMINI_API_KEY') || localStorage.getItem('gemini_api_key')) : null) || 
      process.env.API_KEY || 
      process.env.GEMINI_API_KEY || 
      "";

    if (!key || !userInput.trim()) return [];
    
    // Don't extract from trivial single-word messages
    if (userInput.trim().length < 8 && !userInput.toLowerCase().includes('remember')) return [];

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: key });

      const prompt = `Analyze this conversational exchange between the user and June (the AI assistant) to extract any enduring facts, project context, preferences, habits, or standing instructions that June should remember across her entire lifetime.

User Input: "${userInput.replace(/"/g, '\\"')}"
June Response: "${modelResponse.slice(0, 1000).replace(/"/g, '\\"')}"

Rules:
1. Only extract long-term information: user preferences, specific project names or repositories, technologies used, coding guidelines, personal facts, recurring goals, or system rules.
2. If this was just a transient lookup (e.g. "what is the time", "check weather"), return an empty array [].
3. For each extracted memory, return a JSON object:
   - "content": A concise, clear factual statement (e.g., "The user's core workspace repository is /home/john-icodebees/Projects/jarvis", "The user prefers modern minimal UI without robotic AI slop").
   - "category": One of "preference", "project", "fact", "instruction", "system", or "personal".
   - "importance": Integer from 1 (minor detail) to 3 (critical permanent preference or project rule).
   - "tags": Array of 1-3 lowercase keywords.

Respond ONLY with valid JSON array: [ ... ] or []`;

      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const text = res.text?.trim() || '[]';
      let items: any[] = [];
      try {
        items = JSON.parse(text);
      } catch (jsonErr) {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) items = JSON.parse(match[0]);
      }

      if (!Array.isArray(items) || items.length === 0) return [];

      const savedMemories: MemoryItem[] = [];
      const db = await this.getDb();

      for (const item of items) {
        if (!item.content || typeof item.content !== 'string' || item.content.trim().length < 5) continue;
        
        const content = item.content.trim();
        // Check if a very similar memory already exists to prevent duplication
        const existing = await db.query(
          `SELECT id FROM memories WHERE content ILIKE $1 OR content ILIKE $2 LIMIT 1;`,
          [`%${content.slice(0, 30)}%`, `%${content.slice(-30)}%`]
        );
        if (existing.rows.length > 0) continue;

        const category = item.category || 'fact';
        const importance = typeof item.importance === 'number' ? Math.max(1, Math.min(3, item.importance)) : 2;
        const tags = Array.isArray(item.tags) ? item.tags : [category];

        const saved = await this.addMemory(content, category, importance, tags);
        savedMemories.push(saved);
      }

      return savedMemories;
    } catch (e) {
      console.warn("Background auto-extraction of lifelong memories failed:", e);
      return [];
    }
  }

  public async getLifetimeStats(): Promise<{
    totalMemories: number;
    totalInteractions: number;
    firstInteraction: string | null;
    lastInteraction: string | null;
  }> {
    try {
      const db = await this.getDb();
      const memCountRes = await db.query(`SELECT COUNT(*) as count FROM memories;`);
      const convStatsRes = await db.query(`
        SELECT 
          COUNT(*) as count, 
          MIN(created_at) as first_turn, 
          MAX(created_at) as last_turn 
        FROM conversation_log;
      `);

      return {
        totalMemories: parseInt((memCountRes.rows[0] as any)?.count || '0', 10),
        totalInteractions: parseInt((convStatsRes.rows[0] as any)?.count || '0', 10),
        firstInteraction: (convStatsRes.rows[0] as any)?.first_turn || null,
        lastInteraction: (convStatsRes.rows[0] as any)?.last_turn || null
      };
    } catch (e) {
      console.error("Failed to fetch lifetime stats:", e);
      return { totalMemories: 0, totalInteractions: 0, firstInteraction: null, lastInteraction: null };
    }
  }

  // --- Direct SQL Console Explorer ---
  public async rawQuery(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number; fields?: any[] }> {
    const db = await this.getDb();
    const res = await db.query(sql, params);
    return {
      rows: res.rows,
      rowCount: res.rows.length,
      fields: res.fields
    };
  }
}

export const dbService = new DatabaseService();
