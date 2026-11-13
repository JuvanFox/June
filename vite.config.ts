import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function systemBridgePlugin(): Plugin {
  return {
    name: 'system-bridge-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/system/')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const endpoint = url.pathname;

        const parseJsonBody = (): Promise<any> => {
          return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                resolve(body ? JSON.parse(body) : {});
              } catch (e) {
                reject(e);
              }
            });
            req.on('error', reject);
          });
        };

        const sendJson = (data: any, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };

        const sendError = (msg: string, status = 500) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: msg }));
        };

        if (endpoint === '/api/system/status' && req.method === 'GET') {
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const cpus = os.cpus();
          return sendJson({
            platform: os.platform(),
            hostname: os.hostname(),
            release: os.release(),
            uptime: Math.floor(os.uptime()),
            cpuModel: cpus[0]?.model || 'Standard CPU',
            cpuCores: cpus.length,
            totalMemMb: Math.round(totalMem / (1024 * 1024)),
            freeMemMb: Math.round(freeMem / (1024 * 1024)),
            usedMemMb: Math.round(usedMem / (1024 * 1024)),
            memUsagePercent: Math.round((usedMem / totalMem) * 100),
            cwd: process.cwd(),
          });
        }

        if (endpoint === '/api/system/exec' && req.method === 'POST') {
          parseJsonBody().then(body => {
            const command = body.command;
            if (!command) return sendError('Command parameter is required', 400);

            const cwd = body.cwd || process.env.HOME || process.cwd();
            exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
              sendJson({
                stdout: stdout || '',
                stderr: stderr || (err ? err.message : ''),
                exitCode: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
                command,
                cwd
              });
            });
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/read-file' && req.method === 'POST') {
          parseJsonBody().then(body => {
            const rawPath = body.path;
            if (!rawPath) return sendError('Path parameter is required', 400);

            const filePath = rawPath.startsWith('~') 
              ? path.join(os.homedir(), rawPath.slice(1)) 
              : path.resolve(rawPath);

            fs.readFile(filePath, 'utf-8', (err, data) => {
              if (err) return sendError(err.message, 404);
              sendJson({ content: data, path: filePath });
            });
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/write-file' && req.method === 'POST') {
          parseJsonBody().then(body => {
            const rawPath = body.path;
            const content = body.content ?? '';
            if (!rawPath) return sendError('Path parameter is required', 400);

            const filePath = rawPath.startsWith('~') 
              ? path.join(os.homedir(), rawPath.slice(1)) 
              : path.resolve(rawPath);

            fs.mkdir(path.dirname(filePath), { recursive: true }, (err) => {
              if (err) return sendError(err.message, 500);
              fs.writeFile(filePath, content, 'utf-8', (err2) => {
                if (err2) return sendError(err2.message, 500);
                sendJson({ success: true, path: filePath, bytes: Buffer.byteLength(content, 'utf-8') });
              });
            });
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/list-files' && req.method === 'POST') {
          parseJsonBody().then(body => {
            const rawPath = body.path || os.homedir();
            const dirPath = rawPath.startsWith('~') 
              ? path.join(os.homedir(), rawPath.slice(1)) 
              : path.resolve(rawPath);

            fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
              if (err) return sendError(err.message, 404);
              const files = entries.map(ent => {
                const fullP = path.join(dirPath, ent.name);
                let size = 0;
                let modified = '';
                try {
                  const stat = fs.statSync(fullP);
                  size = stat.size;
                  modified = stat.mtime.toISOString();
                } catch (_) {}
                return {
                  name: ent.name,
                  path: fullP,
                  isDirectory: ent.isDirectory(),
                  size,
                  modified
                };
              });
              sendJson({ path: dirPath, files });
            });
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/vscode' && req.method === 'POST') {
          parseJsonBody().then(body => {
            const codeBin = fs.existsSync('/snap/bin/code') ? '/snap/bin/code' : 'code';
            const action = body.action || 'open';
            let cmd = '';

            if (action === 'diff') {
              if (!body.file1 || !body.file2) return sendError('file1 and file2 required for diff', 400);
              cmd = `${codeBin} -d "${path.resolve(body.file1)}" "${path.resolve(body.file2)}"`;
            } else if (action === 'extensions') {
              cmd = `${codeBin} --list-extensions`;
            } else {
              const rawPath = body.path || process.cwd();
              const fullPath = rawPath.startsWith('~') 
                ? path.join(os.homedir(), rawPath.slice(1)) 
                : path.resolve(rawPath);

              if (body.line) {
                const lineCol = body.column ? `${body.line}:${body.column}` : `${body.line}`;
                cmd = `${codeBin} -r -g "${fullPath}:${lineCol}"`;
              } else {
                cmd = `${codeBin} -r "${fullPath}"`;
              }
            }

            exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
              sendJson({
                success: !err,
                output: stdout.trim() || stderr.trim() || 'Executed',
                command: cmd
              });
            });
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/search-code' && req.method === 'POST') {
          parseJsonBody().then(body => {
            const query = body.query;
            if (!query) return sendError('Query parameter is required', 400);
            const targetDir = body.path ? (body.path.startsWith('~') ? path.join(os.homedir(), body.path.slice(1)) : path.resolve(body.path)) : process.cwd();

            const escapedQuery = query.replace(/(["'$`\\])/g, '\\$1');
            const cmd = `grep -rnI --exclude-dir={node_modules,.git,dist,build,.next,.cache} -m 50 "${escapedQuery}" "${targetDir}"`;

            exec(cmd, { cwd: targetDir, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
              const lines = (stdout || '').split('\n').filter(Boolean);
              const matches = lines.map(line => {
                const parts = line.split(':');
                const file = parts[0];
                const lineNum = parseInt(parts[1], 10);
                const codeSnippet = parts.slice(2).join(':').trim();
                return { file, line: lineNum, snippet: codeSnippet };
              });
              sendJson({ query, targetDir, count: matches.length, matches });
            });
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/fetch-url' && req.method === 'POST') {
          parseJsonBody().then(async body => {
            const rawUrl = body.url;
            if (!rawUrl) return sendError('URL parameter is required', 400);

            let targetUrl = rawUrl.trim();
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
              targetUrl = 'https://' + targetUrl;
            }

            try {
              const resp = await fetch(targetUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(12000)
              });

              if (!resp.ok) {
                return sendError(`HTTP error: ${resp.status} ${resp.statusText}`, resp.status);
              }

              const html = await resp.text();

              // Extract title
              const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
              const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : targetUrl;

              // Clean text content
              const cleanContent = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
                .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
                .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 8000);

              // Extract key links
              const linkMatches = [...html.matchAll(/<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
              const links: { title: string; url: string }[] = [];
              for (const m of linkMatches) {
                let linkUrl = m[1].trim();
                const linkText = m[2].replace(/<[^>]+>/g, '').trim();
                if (linkText && linkUrl && !linkUrl.startsWith('#') && !linkUrl.startsWith('javascript:')) {
                  try {
                    linkUrl = new URL(linkUrl, targetUrl).href;
                    if (!links.some(l => l.url === linkUrl)) {
                      links.push({ title: linkText.slice(0, 80), url: linkUrl });
                    }
                  } catch (_) {}
                }
                if (links.length >= 10) break;
              }

              sendJson({
                url: targetUrl,
                title,
                content: cleanContent,
                links,
                status: resp.status
              });
            } catch (fetchErr: any) {
              sendError(fetchErr.message || 'Failed to fetch webpage', 500);
            }
          }).catch(e => sendError(e.message, 400));
          return;
        }

        if (endpoint === '/api/system/search' && req.method === 'POST') {
          parseJsonBody().then(async body => {
            const query = body.query;
            if (!query) return sendError('Query parameter is required', 400);

            try {
              // Fetch DuckDuckGo HTML search results
              const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
              const resp = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                signal: AbortSignal.timeout(10000)
              });

              const html = await resp.text();
              const results: { title: string; snippet: string; url: string }[] = [];

              // Parse DuckDuckGo search results
              const resultBlocks = html.split('<div class="result results_links results_links_deep web-result');
              for (let i = 1; i < resultBlocks.length && results.length < 5; i++) {
                const block = resultBlocks[i];
                
                // Extract URL
                const urlMatch = block.match(/href="([^"]+)"/);
                let url = urlMatch ? urlMatch[1] : '';
                if (url.includes('uddg=')) {
                  try {
                    const parsedUddg = new URL('https:' + url).searchParams.get('uddg');
                    if (parsedUddg) url = parsedUddg;
                  } catch (_) {}
                } else if (url.startsWith('//')) {
                  url = 'https:' + url;
                }

                // Extract Title
                const titleMatch = block.match(/<a[^>]*class="result__snippet[^>]*>([\s\S]*?)<\/a>/) || 
                                   block.match(/<a[^>]*class="result__url[^>]*>([\s\S]*?)<\/a>/) ||
                                   block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
                const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Search Result';

                // Extract Snippet
                const snippetMatch = block.match(/<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/);
                const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

                if (url && (title || snippet)) {
                  results.push({
                    title: title.slice(0, 120),
                    snippet: snippet.slice(0, 300),
                    url
                  });
                }
              }

              sendJson({ query, results, count: results.length });
            } catch (searchErr: any) {
              sendError(searchErr.message || 'Web search failed', 500);
            }
          }).catch(e => sendError(e.message, 400));
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3030,
        host: '0.0.0.0',
        open: true,
      },
      optimizeDeps: {
        exclude: ['@electric-sql/pglite'],
      },
      plugins: [react(), systemBridgePlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
