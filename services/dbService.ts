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
   * Generates a concise summary of June's persistent memories to feed directly
   * into the systemInstruction prompt of the Gemini model.
   */
  public async getMemoriesSummaryForPrompt(): Promise<string> {
    try {
      const memories = await this.getMemories();
      if (!memories.length) return '';

      const lines = memories.map(m => `- [${m.category.toUpperCase()}] ${m.content}`);
      return `\n\nLONG-TERM MEMORY (stored in embedded Postgres Lite):\n${lines.join('\n')}\n(Use these persistent memories to inform your decisions, recall user details, and maintain context across conversations.)`;
    } catch (e) {
      console.error('Failed to build memory summary:', e);
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
