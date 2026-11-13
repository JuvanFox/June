export interface SystemStatus {
  platform: string;
  hostname: string;
  release: string;
  uptime: number;
  cpuModel: string;
  cpuCores: number;
  totalMemMb: number;
  freeMemMb: number;
  usedMemMb: number;
  memUsagePercent: number;
  cwd: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  cwd: string;
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
}

export async function executeCommand(command: string, cwd?: string): Promise<CommandResult> {
  const res = await fetch('/api/system/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, cwd }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Command execution failed');
  }
  return res.json();
}

export async function readSystemFile(filePath: string): Promise<{ content: string; path: string }> {
  const res = await fetch('/api/system/read-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Failed to read file');
  }
  return res.json();
}

export async function writeSystemFile(filePath: string, content: string): Promise<{ success: boolean; path: string; bytes: number }> {
  const res = await fetch('/api/system/write-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Failed to write file');
  }
  return res.json();
}

export async function listSystemFiles(dirPath?: string): Promise<{ path: string; files: FileItem[] }> {
  const res = await fetch('/api/system/list-files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Failed to list directory');
  }
  return res.json();
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const res = await fetch('/api/system/status');
  if (!res.ok) {
    throw new Error('Failed to fetch system metrics');
  }
  return res.json();
}

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

export async function searchInternet(query: string): Promise<{ query: string; results: WebSearchResult[]; count: number }> {
  const res = await fetch('/api/system/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Web search failed');
  }
  return res.json();
}

export interface WebpageContent {
  url: string;
  title: string;
  content: string;
  links: { title: string; url: string }[];
  status: number;
}

export async function fetchWebpage(url: string): Promise<WebpageContent> {
  const res = await fetch('/api/system/fetch-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Failed to fetch webpage');
  }
  return res.json();
}

export interface CodeSearchMatch {
  file: string;
  line: number;
  snippet: string;
}

export interface CodeSearchResult {
  query: string;
  targetDir: string;
  count: number;
  matches: CodeSearchMatch[];
}

export async function openInVSCode(options: { 
  path?: string; 
  line?: number; 
  column?: number; 
  action?: 'open' | 'diff' | 'extensions';
  file1?: string;
  file2?: string;
}): Promise<{ success: boolean; output: string; command: string }> {
  const res = await fetch('/api/system/vscode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'VS Code operation failed');
  }
  return res.json();
}

export async function searchCode(query: string, dirPath?: string): Promise<CodeSearchResult> {
  const res = await fetch('/api/system/search-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, path: dirPath }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || 'Code search failed');
  }
  return res.json();
}
