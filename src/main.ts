/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter, parseQuery } from '@songloft/plugin-sdk';

const router = createRouter();

interface Book {
  path: string;
  title: string;
  author: string;
  cover: string;
  description: string;
  chapterCount: number;
  totalSize: number;
}

interface Chapter {
  name: string;
  path: string;
  size: number;
}

interface ScanProgress {
  status: 'idle' | 'scanning' | 'completed' | 'failed';
  booksFound: number;
  currentFolder: string;
  error?: string;
}

let scanProgress: ScanProgress = { status: 'idle', booksFound: 0, currentFolder: '' };
let activeScanPromise: Promise<void> | null = null;

const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.opus'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];

function isAudio(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return AUDIO_EXTS.includes(ext);
}

function isImage(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

async function runScan() {
  console.log('[Scan] Starting audiobook directory scan...');
  scanProgress.status = 'scanning';
  scanProgress.booksFound = 0;
  scanProgress.currentFolder = '';

  const rootDir = '/app/audiobook';
  const queue: string[] = [rootDir];
  const books: Book[] = [];

  let dirsProcessedSinceYield = 0;

  try {
    while (queue.length > 0) {
      const dir = queue.shift()!;
      scanProgress.currentFolder = dir;
      dirsProcessedSinceYield++;

      let entries: any[] = [];
      try {
        entries = await songloft.fs.readdir(dir);
      } catch (e: any) {
        console.error(`[Scan] Failed to read directory ${dir}:`, e.message || String(e));
        continue;
      }

      let hasAudio = false;
      let coverPath = '';
      let audioCount = 0;
      let audioSizeSum = 0;
      const audioFiles: string[] = [];

      for (const entry of entries) {
        const entryPath = `${dir}/${entry.name}`;
        if (entry.isDir) {
          queue.push(entryPath);
        } else {
          if (isAudio(entry.name)) {
            hasAudio = true;
            audioCount++;
            audioFiles.push(entryPath);
          } else if (isImage(entry.name) && !coverPath) {
            coverPath = entryPath;
          }
        }
      }

      if (hasAudio) {
        // 分批并发查询文件体积，每批最多 50 个请求，防止撑爆 Go-JS 桥接异步队列
        try {
          const chunkSize = 50;
          for (let i = 0; i < audioFiles.length; i += chunkSize) {
            const chunk = audioFiles.slice(i, i + chunkSize);
            const stats = await Promise.all(
              chunk.map(filePath =>
                songloft.fs.stat(filePath).catch(() => ({ size: 0 }))
              )
            );
            for (const stat of stats) {
              audioSizeSum += stat.size || 0;
            }
          }
        } catch (e) {
          console.error(`[Scan] Failed to stat audio files in ${dir}:`, e);
        }

        let title = dir.slice(dir.lastIndexOf('/') + 1);
        let author = '未知作者';
        let description = '本地有声书';
        let type = '默认';
        let tags: string[] = [];

        // 直接读取 metadata.json，减少 1 次 exists() RPC 往返
        const metaPath = `${dir}/metadata.json`;
        try {
          const content = await songloft.fs.readFile(metaPath, { encoding: 'utf-8' });
          const meta = JSON.parse(content);
          if (meta.title) title = meta.title;
          if (meta.author) author = meta.author;
          if (meta.description) description = meta.description;
          if (meta.type) type = meta.type;
          if (meta.tags) tags = Array.isArray(meta.tags) ? meta.tags : meta.tags.split(',').map((t: string) => t.trim());
          if (meta.cover) {
            if (meta.cover.startsWith('/')) {
              coverPath = meta.cover;
            } else {
              coverPath = `${dir}/${meta.cover}`;
            }
          }
        } catch (e) {
          // 忽略读取失败，使用默认值
        }

        const book = {
          path: dir,
          title,
          author,
          cover: coverPath,
          description,
          chapterCount: audioCount,
          totalSize: audioSizeSum,
          type,
          tags,
        };
        books.push(book);
        scanProgress.booksFound = books.length;
        console.log(`[Scan] Found book: "${title}" at ${dir} with ${audioCount} chapters`);
        
        // 发现书籍时出让控制权，让 UI 及状态正常更新
        await new Promise(resolve => setTimeout(resolve, 0));
        dirsProcessedSinceYield = 0;
      } else {
        // 无音频的子目录，每 20 个出让一次控制权，避免过度频繁调用 setTimeout 增加调度开销
        if (dirsProcessedSinceYield >= 20) {
          await new Promise(resolve => setTimeout(resolve, 0));
          dirsProcessedSinceYield = 0;
        }
      }
    }

    console.log(`[Scan] Scan completed. Saving ${books.length} books to storage.`);
    await songloft.storage.set('books', JSON.stringify(books));
    scanProgress.status = 'completed';
  } catch (err: any) {
    console.error('[Scan] Critical error during scan:', err.message || String(err));
    scanProgress.status = 'failed';
    scanProgress.error = err.message || String(err);
  } finally {
    activeScanPromise = null;
  }
}

router.get('/api/scan-status', async () => {
  return jsonResponse(scanProgress);
});

router.post('/api/scan', async () => {
  if (scanProgress.status === 'scanning') {
    return jsonResponse({ error: 'Scan already in progress' }, 400);
  }
  activeScanPromise = runScan();
  return jsonResponse({ started: true });
});

router.get('/api/books', async () => {
  const data = await songloft.storage.get('books');
  const books = data ? JSON.parse(data as string) : [];
  return jsonResponse({ books });
});

router.get('/api/chapters', async (req) => {
  const q = parseQuery(req.query);
  const bookPath = q.path;
  if (!bookPath) {
    return jsonResponse({ error: 'path parameter is required' }, 400);
  }

  let entries: any[] = [];
  try {
    entries = await songloft.fs.readdir(bookPath);
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }

  const chapters: Chapter[] = [];
  for (const entry of entries) {
    if (!entry.isDir && isAudio(entry.name)) {
      const entryPath = `${bookPath}/${entry.name}`;
      let size = 0;
      try {
        const stat = await songloft.fs.stat(entryPath);
        size = stat.size || 0;
      } catch (e) {}
      chapters.push({
        name: entry.name,
        path: entryPath,
        size,
      });
    }
  }

  chapters.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return jsonResponse({ chapters });
});

router.get('/api/stream', async (req) => {
  const q = parseQuery(req.query);
  const path = q.path;
  if (!path) {
    return jsonResponse({ error: 'path is required' }, 400);
  }
  return {
    serveFile: {
      filePath: path
    }
  } as any;
});

function getSafeStorageKey(bookPath: string): string {
  return `progress_${bookPath.replace(/[\/\\]/g, '_')}`;
}

router.post('/api/progress', async (req) => {
  const body = JSON.parse(req.body);
  const { bookPath, chapterPath, chapterName, offset, duration } = body;
  if (!bookPath) {
    return jsonResponse({ error: 'bookPath is required' }, 400);
  }

  const progress = {
    chapterPath,
    chapterName,
    offset,
    duration,
    updatedAt: Date.now()
  };

  const key = getSafeStorageKey(bookPath);
  await songloft.storage.set(key, JSON.stringify(progress));

  await songloft.storage.set('last_played_book', JSON.stringify({
    bookPath,
    chapterName,
    updatedAt: Date.now()
  }));

  return jsonResponse({ ok: true });
});

router.get('/api/progress', async (req) => {
  const q = parseQuery(req.query);
  const bookPath = q.path;
  if (!bookPath) {
    const lastData = await songloft.storage.get('last_played_book');
    return jsonResponse({ lastPlayed: lastData ? JSON.parse(lastData as string) : null });
  }

  const key = getSafeStorageKey(bookPath);
  const data = await songloft.storage.get(key);
  return jsonResponse({ progress: data ? JSON.parse(data as string) : null });
});

router.post('/api/books/update', async (req) => {
  const body = JSON.parse(req.body);
  const { path, title, author, description, type, tags, coverUrl, coverBase64, coverExt } = body;
  if (!path) {
    return jsonResponse({ error: 'path is required' }, 400);
  }

  let finalCoverPath = coverUrl || '';
  if (coverBase64) {
    const ext = coverExt || 'jpg';
    const coverName = `cover.${ext}`;
    const fullCoverPath = `${path}/${coverName}`;
    try {
      await songloft.fs.writeFile(fullCoverPath, coverBase64, { encoding: 'base64' });
      finalCoverPath = fullCoverPath;
    } catch (e: any) {
      console.error(`[Edit] Failed to save cover file: ${e.message}`);
    }
  }

  const metaPath = `${path}/metadata.json`;
  const metaContent = {
    title: title || '',
    author: author || '未知作者',
    description: description || '',
    type: type || '默认',
    tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map((t: string) => t.trim())) : [],
    cover: finalCoverPath ? (finalCoverPath.startsWith(path) ? finalCoverPath.slice(path.length + 1) : finalCoverPath) : ''
  };

  try {
    await songloft.fs.writeFile(metaPath, JSON.stringify(metaContent, null, 2));
  } catch (e: any) {
    console.error(`[Edit] Failed to write metadata.json: ${e.message}`);
    return jsonResponse({ error: `Failed to write metadata.json: ${e.message}` }, 500);
  }

  try {
    const data = await songloft.storage.get('books');
    const books = data ? JSON.parse(data as string) : [];
    const bookIndex = books.findIndex((b: any) => b.path === path);
    if (bookIndex >= 0) {
      books[bookIndex].title = title || books[bookIndex].title;
      books[bookIndex].author = author || '未知作者';
      books[bookIndex].description = description || '';
      books[bookIndex].cover = finalCoverPath;
      books[bookIndex].type = type || '默认';
      books[bookIndex].tags = metaContent.tags;
      await songloft.storage.set('books', JSON.stringify(books));
    }
  } catch (e: any) {
    console.error(`[Edit] Failed to update storage books list: ${e.message}`);
  }

  return jsonResponse({ ok: true });
});

globalThis.onHTTPRequest = async (req: HTTPRequest) => router.handle(req);
