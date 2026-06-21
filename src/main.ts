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
  scanProgress.status = 'scanning';
  scanProgress.booksFound = 0;
  scanProgress.currentFolder = '';

  const rootDir = '/app/audiobook';
  const queue: string[] = [rootDir];
  const books: Book[] = [];

  try {
    while (queue.length > 0) {
      const dir = queue.shift()!;
      scanProgress.currentFolder = dir;

      let entries: any[] = [];
      try {
        entries = await songloft.fs.readdir(dir);
      } catch (e) {
        continue;
      }

      let hasAudio = false;
      let coverPath = '';
      let audioCount = 0;
      let audioSizeSum = 0;

      for (const entry of entries) {
        const entryPath = `${dir}/${entry.name}`;
        if (entry.isDir) {
          queue.push(entryPath);
        } else {
          if (isAudio(entry.name)) {
            hasAudio = true;
            audioCount++;
            try {
              const stat = await songloft.fs.stat(entryPath);
              audioSizeSum += stat.size || 0;
            } catch (e) {}
          } else if (isImage(entry.name) && !coverPath) {
            coverPath = entryPath;
          }
        }
      }

      if (hasAudio) {
        let title = dir.slice(dir.lastIndexOf('/') + 1);
        let author = '未知作者';
        let description = '本地有声书';

        const metaPath = `${dir}/metadata.json`;
        try {
          const exists = await songloft.fs.exists(metaPath);
          if (exists) {
            const content = await songloft.fs.readFile(metaPath, { encoding: 'utf-8' });
            const meta = JSON.parse(content);
            if (meta.title) title = meta.title;
            if (meta.author) author = meta.author;
            if (meta.description) description = meta.description;
            if (meta.cover) {
              if (meta.cover.startsWith('/')) {
                coverPath = meta.cover;
              } else {
                coverPath = `${dir}/${meta.cover}`;
              }
            }
          }
        } catch (e) {}

        books.push({
          path: dir,
          title,
          author,
          cover: coverPath,
          description,
          chapterCount: audioCount,
          totalSize: audioSizeSum,
        });
        scanProgress.booksFound = books.length;
      }

      // 出让控制权给 Microtask 循环，防止长时间阻塞导致的 QuickJS wall-clock 超时
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    await songloft.storage.set('books', JSON.stringify(books));
    scanProgress.status = 'completed';
  } catch (err: any) {
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

  const key = `progress_${bookPath}`;
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

  const key = `progress_${bookPath}`;
  const data = await songloft.storage.get(key);
  return jsonResponse({ progress: data ? JSON.parse(data as string) : null });
});

globalThis.onHTTPRequest = async (req: HTTPRequest) => router.handle(req);
