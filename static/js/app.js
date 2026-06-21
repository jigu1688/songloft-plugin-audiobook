// ============================================================
// 有声书插件 — 前端逻辑
// ============================================================

(function () {
  // 全局状态
  const state = {
    books: [],
    filteredBooks: [],
    selectedBook: null,
    selectedBookChapters: [],
    currentBook: null,
    currentChapter: null,
    isPlaying: false,
    speed: 1.0,
    volume: 0.8,
    isMuted: false,
    sortBy: 'name',
    searchQuery: '',
    scanInterval: null,
    lastProgressSave: 0,
  };

  // DOM 元素引用
  const dom = {
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    scanBtn: document.getElementById('scan-btn'),
    scanSpinner: document.querySelector('#scan-btn .spinner'),
    scanBtnText: document.querySelector('#scan-btn .btn-text'),
    sortSelect: document.getElementById('sort-select'),
    bookCount: document.getElementById('book-count'),
    scanProgressBanner: document.getElementById('scan-progress-banner'),
    progressCount: document.getElementById('progress-count'),
    progressFolder: document.getElementById('progress-folder'),
    recentSection: document.getElementById('recent-section'),
    recentGrid: document.getElementById('recent-grid'),
    booksGrid: document.getElementById('books-grid'),
    emptyState: document.getElementById('empty-state'),
    
    // 侧边栏 Drawer
    drawerOverlay: document.getElementById('drawer-overlay'),
    drawer: document.getElementById('drawer'),
    drawerClose: document.getElementById('drawer-close'),
    drawerCover: document.getElementById('drawer-cover'),
    drawerTitle: document.getElementById('drawer-title'),
    drawerAuthor: document.getElementById('drawer-author'),
    drawerStats: document.getElementById('drawer-stats'),
    playAllBtn: document.getElementById('play-all-btn'),
    chapterList: document.getElementById('chapter-list'),
    
    // 播放器
    playerBar: document.getElementById('player-bar'),
    playerCover: document.getElementById('player-cover'),
    playerTitle: document.getElementById('player-title'),
    playerBook: document.getElementById('player-book'),
    speedBtn: document.getElementById('speed-btn'),
    speedMenu: document.getElementById('speed-menu'),
    skipBackBtn: document.getElementById('skip-back-btn'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    svgPlay: document.getElementById('svg-play'),
    svgPause: document.getElementById('svg-pause'),
    skipForwardBtn: document.getElementById('skip-forward-btn'),
    nextBtn: document.getElementById('next-btn'),
    playerTimeCurrent: document.getElementById('player-time-current'),
    playerProgressSlider: document.getElementById('player-progress-slider'),
    playerTimeDuration: document.getElementById('player-time-duration'),
    volumeMuteBtn: document.getElementById('volume-mute-btn'),
    svgVol: document.getElementById('svg-vol'),
    svgMute: document.getElementById('svg-mute'),
    volumeSlider: document.getElementById('volume-slider'),
    
    audio: document.getElementById('html5-audio')
  };

  // 基础 API 请求封装 (携带 JWT 认证)
  async function apiRequest(path, options = {}) {
    options.headers = options.headers || {};
    try {
      const authData = JSON.parse(localStorage.getItem('songloft-auth') || '{}');
      if (authData.accessToken) {
        options.headers['Authorization'] = `Bearer ${authData.accessToken}`;
      }
    } catch (e) {
      console.error('Failed to parse auth token', e);
    }

    const response = await fetch(path, options);
    if (response.status === 401) {
      alert('登录已过期，请重新登录 Songloft');
      return;
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || err.detail || '请求失败');
    }
    return response.json();
  }

  // 格式化时长 (秒 -> 00:00:00 或 00:00)
  function formatDuration(seconds) {
    if (isNaN(seconds) || seconds === Infinity || seconds <= 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (num) => String(num).padStart(2, '0');
    if (h > 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  }

  // 格式化文件大小
  function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let val = bytes;
    let unitIdx = 0;
    while (val >= 1024 && unitIdx < units.length - 1) {
      val /= 1024;
      unitIdx++;
    }
    return `${val.toFixed(1)} ${units[unitIdx]}`;
  }

  // 加载书籍列表
  async function loadBooks() {
    try {
      const data = await apiRequest('api/books');
      state.books = data.books || [];
      filterAndSortBooks();
      updateLastPlayedUI();
    } catch (err) {
      console.error('Failed to load books:', err);
    }
  }

  // 过滤和排序书籍
  function filterAndSortBooks() {
    const query = dom.searchInput.value.trim().toLowerCase();
    state.searchQuery = query;

    state.filteredBooks = state.books.filter(book => {
      return (
        book.title.toLowerCase().includes(query) ||
        book.author.toLowerCase().includes(query) ||
        (book.description && book.description.toLowerCase().includes(query))
      );
    });

    // 排序
    const sortBy = dom.sortSelect.value;
    state.sortBy = sortBy;
    if (sortBy === 'name') {
      state.filteredBooks.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    } else if (sortBy === 'chapters') {
      state.filteredBooks.sort((a, b) => b.chapterCount - a.chapterCount);
    } else if (sortBy === 'size') {
      state.filteredBooks.sort((a, b) => b.totalSize - a.totalSize);
    }

    renderBooks();
  }

  // 渲染书籍网格
  function renderBooks() {
    dom.bookCount.textContent = `共 ${state.filteredBooks.length} 本`;

    if (state.filteredBooks.length === 0) {
      dom.booksGrid.innerHTML = '';
      dom.emptyState.classList.remove('hidden');
      return;
    }

    dom.emptyState.classList.add('hidden');
    dom.booksGrid.innerHTML = state.filteredBooks.map(book => {
      // 封面如果是绝对路径，我们可以通过 `/api/v1/jsplugin/audiobook/files/...` 访问它。
      // 在 Go 路由中，`/api/v1/jsplugin/{entryPath}/files/*` 会直接 serve。
      // 所以如果 book.cover 是绝对路径，我们转为 `files/{absPath}` 相对当前 base URL 即可。
      let coverUrl = 'static/css/placeholder-cover.svg';
      if (book.cover) {
        coverUrl = `files/${book.cover.replace(/^\/+/, '')}`;
      }

      return `
        <div class="book-card" data-path="${encodeURIComponent(book.path)}">
          <img class="book-cover" src="${coverUrl}" alt="${book.title}" onerror="this.src='static/css/placeholder-cover.svg'">
          <div class="book-overlay">
            <div class="book-title" title="${book.title}">${book.title}</div>
            <div class="book-info-text">${book.chapterCount} 章节 · ${formatSize(book.totalSize)}</div>
          </div>
        </div>
      `;
    }).join('');

    // 添加事件监听
    dom.booksGrid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => {
        const bookPath = decodeURIComponent(card.getAttribute('data-path'));
        openBookDetail(bookPath);
      });
    });
  }

  // 打开书籍详情 Drawer
  async function openBookDetail(bookPath) {
    const book = state.books.find(b => b.path === bookPath);
    if (!book) return;

    state.selectedBook = book;
    
    // 设置 Drawer 元数据
    let coverUrl = 'static/css/placeholder-cover.svg';
    if (book.cover) {
      coverUrl = `files/${book.cover.replace(/^\/+/, '')}`;
    }
    dom.drawerCover.src = coverUrl;
    dom.drawerTitle.textContent = book.title;
    dom.drawerAuthor.textContent = book.author || '未知作者';
    dom.drawerStats.textContent = `${book.chapterCount} 章节 · ${formatSize(book.totalSize)}`;

    // 显示 Drawer
    dom.drawerOverlay.classList.remove('hidden');
    dom.drawer.classList.remove('hidden');

    // 渲染加载态
    dom.chapterList.innerHTML = '<div style="padding: 20px; text-align: center;">加载章节中...</div>';

    try {
      // 获取章节列表
      const chaptersData = await apiRequest(`api/chapters?path=${encodeURIComponent(bookPath)}`);
      state.selectedBookChapters = chaptersData.chapters || [];

      // 获取各章节的播放进度
      const progressData = await apiRequest(`api/progress?path=${encodeURIComponent(bookPath)}`).catch(() => ({}));
      const progress = progressData.progress || {};

      renderChapters(progress);
    } catch (err) {
      dom.chapterList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--error);">获取章节失败: ${err.message}</div>`;
    }
  }

  // 渲染章节列表
  function renderChapters(bookProgress) {
    if (state.selectedBookChapters.length === 0) {
      dom.chapterList.innerHTML = '<div style="padding: 20px; text-align: center;">此书籍无音频文件</div>';
      return;
    }

    dom.chapterList.innerHTML = state.selectedBookChapters.map((chapter, idx) => {
      const isActive = state.currentChapter && state.currentChapter.path === chapter.path;
      
      // 计算本章节的进度条 (如果是当前播放的或者有历史进度的)
      let progressPercent = 0;
      let progressText = '';
      if (isActive && dom.audio.duration) {
        progressPercent = (dom.audio.currentTime / dom.audio.duration) * 100;
        progressText = `已听 ${formatDuration(dom.audio.currentTime)}`;
      } else if (bookProgress && bookProgress.chapterPath === chapter.path) {
        const offset = bookProgress.offset || 0;
        const dur = bookProgress.duration || 1;
        progressPercent = (offset / dur) * 100;
        progressText = `已听 ${formatDuration(offset)}`;
      }

      return `
        <div class="chapter-item ${isActive ? 'active' : ''}" data-path="${encodeURIComponent(chapter.path)}">
          <div class="chapter-left">
            <span class="chapter-title" title="${chapter.name}">${chapter.name}</span>
            <div class="chapter-meta">
              <span>大小: ${formatSize(chapter.size)}</span>
              ${progressPercent > 0 ? `
                <span class="progress-bar-mini">
                  <span class="progress-fill-mini" style="width: ${progressPercent}%"></span>
                </span>
                <span>${progressText}</span>
              ` : ''}
            </div>
          </div>
          <div class="chapter-right">
            <svg viewBox="0 0 24 24" class="svg-icon" style="width: 16px; height: 16px;"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>
          </div>
        </div>
      `;
    }).join('');

    // 绑定点击播放事件
    dom.chapterList.querySelectorAll('.chapter-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = decodeURIComponent(item.getAttribute('data-path'));
        const chapter = state.selectedBookChapters.find(c => c.path === path);
        if (chapter) {
          playChapter(state.selectedBook, chapter);
        }
      });
    });
  }

  // 关闭 Drawer
  function closeDrawer() {
    dom.drawerOverlay.classList.add('hidden');
    dom.drawer.classList.add('hidden');
  }

  // 开始播放特定章节
  async function playChapter(book, chapter, restoreOffset = null) {
    state.currentBook = book;
    state.currentChapter = chapter;

    // 更新播放器 UI
    dom.playerTitle.textContent = chapter.name;
    dom.playerBook.textContent = book.title;
    
    let coverUrl = 'static/css/placeholder-cover.svg';
    if (book.cover) {
      coverUrl = `files/${book.cover.replace(/^\/+/, '')}`;
    }
    dom.playerCover.src = coverUrl;

    // 显示播放器栏
    dom.playerBar.classList.remove('hidden');

    // 准备播放地址：通过 /api/stream 服务文件
    const audioUrl = `api/stream?path=${encodeURIComponent(chapter.path)}`;
    
    dom.audio.src = audioUrl;
    dom.audio.playbackRate = state.speed;
    dom.audio.volume = state.isMuted ? 0 : state.volume;

    // 获取并恢复播放历史
    let offsetToSeek = restoreOffset;
    if (offsetToSeek === null) {
      try {
        const progressData = await apiRequest(`api/progress?path=${encodeURIComponent(book.path)}`);
        if (progressData.progress && progressData.progress.chapterPath === chapter.path) {
          offsetToSeek = progressData.progress.offset || 0;
        }
      } catch (err) {
        console.error('Failed to load progress', err);
      }
    }

    if (offsetToSeek) {
      // 监听 metadata 加载完毕后再 seek，确保可靠
      const seekOnLoad = () => {
        dom.audio.currentTime = offsetToSeek;
        dom.audio.removeEventListener('loadedmetadata', seekOnLoad);
      };
      dom.audio.addEventListener('loadedmetadata', seekOnLoad);
    }

    // 开始播放
    dom.audio.play()
      .then(() => {
        state.isPlaying = true;
        updatePlayPauseUI();
      })
      .catch(err => {
        console.error('Playback failed:', err);
      });

    // 刷新 Drawer 列表状态 (如果当前打开了同一个书的 Drawer)
    if (state.selectedBook && state.selectedBook.path === book.path) {
      // 获取最新进度再次渲染
      const progressData = await apiRequest(`api/progress?path=${encodeURIComponent(book.path)}`).catch(() => ({}));
      renderChapters(progressData.progress);
    }
    
    updateRecentlyPlayed();
  }

  // 播放/暂停
  function togglePlay() {
    if (!state.currentChapter) return;
    if (state.isPlaying) {
      dom.audio.pause();
      state.isPlaying = false;
    } else {
      dom.audio.play().catch(console.error);
      state.isPlaying = true;
    }
    updatePlayPauseUI();
    saveProgress(true); // 发生状态切换时强制立即保存进度
  }

  function updatePlayPauseUI() {
    if (state.isPlaying) {
      dom.svgPlay.classList.add('hidden');
      dom.svgPause.classList.remove('hidden');
    } else {
      dom.svgPlay.classList.remove('hidden');
      dom.svgPause.classList.add('hidden');
    }
  }

  // 15 秒快退/快进
  function skipTime(seconds) {
    if (!state.currentChapter) return;
    dom.audio.currentTime = Math.max(0, Math.min(dom.audio.duration || 0, dom.audio.currentTime + seconds));
    updateProgressUI();
    saveProgress(true);
  }

  // 自动播放下一章
  function playNextChapter() {
    if (!state.currentBook || !state.currentChapter) return;
    
    // 如果没有加载当前书的章节，需要先拉一下
    if (state.selectedBook && state.selectedBook.path === state.currentBook.path && state.selectedBookChapters.length > 0) {
      triggerNextChapter(state.selectedBookChapters);
    } else {
      apiRequest(`api/chapters?path=${encodeURIComponent(state.currentBook.path)}`)
        .then(data => {
          triggerNextChapter(data.chapters || []);
        })
        .catch(console.error);
    }
  }

  function triggerNextChapter(chapters) {
    const currentIdx = chapters.findIndex(c => c.path === state.currentChapter.path);
    if (currentIdx >= 0 && currentIdx < chapters.length - 1) {
      const nextChapter = chapters[currentIdx + 1];
      playChapter(state.currentBook, nextChapter);
    } else {
      alert('已播放到最后一章');
      state.isPlaying = false;
      updatePlayPauseUI();
    }
  }

  // 倍速控制
  function selectSpeed(speed) {
    state.speed = speed;
    dom.speedBtn.textContent = `${speed}x`;
    dom.audio.playbackRate = speed;
    dom.speedMenu.classList.add('hidden');
    
    // 更新倍速菜单的活跃状态
    dom.speedMenu.querySelectorAll('.speed-option').forEach(opt => {
      const val = parseFloat(opt.getAttribute('data-speed'));
      opt.classList.toggle('active', val === speed);
    });
  }

  // 音量控制
  function handleVolumeChange() {
    const val = dom.volumeSlider.value / 100;
    state.volume = val;
    state.isMuted = false;
    dom.audio.volume = val;
    dom.audio.muted = false;
    updateVolumeUI();
  }

  function toggleMute() {
    state.isMuted = !state.isMuted;
    dom.audio.muted = state.isMuted;
    updateVolumeUI();
  }

  function updateVolumeUI() {
    if (state.isMuted || state.volume === 0) {
      dom.svgVol.classList.add('hidden');
      dom.svgMute.classList.remove('hidden');
    } else {
      dom.svgVol.classList.remove('hidden');
      dom.svgMute.classList.add('hidden');
    }
  }

  // 进度更新事件
  function handleTimeUpdate() {
    updateProgressUI();
    
    // 节流保存播放进度：每 8 秒自动向后端同步一次
    const now = Date.now();
    if (now - state.lastProgressSave > 8000) {
      saveProgress(false);
      state.lastProgressSave = now;
    }
  }

  function updateProgressUI() {
    const curTime = dom.audio.currentTime || 0;
    const duration = dom.audio.duration || 0;
    dom.playerTimeCurrent.textContent = formatDuration(curTime);
    dom.playerTimeDuration.textContent = formatDuration(duration);
    
    if (duration > 0) {
      dom.playerProgressSlider.value = (curTime / duration) * 100;
    } else {
      dom.playerProgressSlider.value = 0;
    }
  }

  // 拖动进度条
  function handleProgressSliderInput() {
    const duration = dom.audio.duration || 0;
    if (duration > 0) {
      const seekTo = (dom.playerProgressSlider.value / 100) * duration;
      dom.audio.currentTime = seekTo;
      dom.playerTimeCurrent.textContent = formatDuration(seekTo);
    }
  }

  // 向后端保存进度
  async function saveProgress(force = false) {
    if (!state.currentBook || !state.currentChapter) return;
    
    const payload = {
      bookPath: state.currentBook.path,
      chapterPath: state.currentChapter.path,
      chapterName: state.currentChapter.name,
      offset: dom.audio.currentTime,
      duration: dom.audio.duration || 0
    };

    try {
      await apiRequest('api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('Failed to sync progress to server:', err);
    }
  }

  // 最近播放列表
  async function updateRecentlyPlayed() {
    // 获取最近播放 (后端是通过 last_played_book 存储)
    try {
      const data = await apiRequest('api/progress');
      if (data.lastPlayed) {
        state.lastPlayed = data.lastPlayed;
        renderRecentlyPlayed();
      }
    } catch (err) {
      console.error('Failed to get last played progress', err);
    }
  }

  function renderRecentlyPlayed() {
    if (!state.lastPlayed) {
      dom.recentSection.classList.add('hidden');
      return;
    }

    const lastPlayedBook = state.books.find(b => b.path === state.lastPlayed.bookPath);
    if (!lastPlayedBook) {
      dom.recentSection.classList.add('hidden');
      return;
    }

    dom.recentSection.classList.remove('hidden');

    let coverUrl = 'static/css/placeholder-cover.svg';
    if (lastPlayedBook.cover) {
      coverUrl = `files/${lastPlayedBook.cover.replace(/^\/+/, '')}`;
    }

    dom.recentGrid.innerHTML = `
      <div class="recent-card" data-book-path="${encodeURIComponent(lastPlayedBook.path)}">
        <img class="book-cover-mini" src="${coverUrl}" alt="" onerror="this.src='static/css/placeholder-cover.svg'">
        <div class="recent-card-info">
          <h3>${lastPlayedBook.title}</h3>
          <div class="chapter-name">${state.lastPlayed.chapterName || '未知章节'}</div>
        </div>
      </div>
    `;

    // 绑定点击事件：直接加载书籍并继续播放
    dom.recentGrid.querySelector('.recent-card').addEventListener('click', async () => {
      const bookPath = decodeURIComponent(dom.recentGrid.querySelector('.recent-card').getAttribute('data-book-path'));
      const book = state.books.find(b => b.path === bookPath);
      if (!book) return;

      try {
        const chaptersData = await apiRequest(`api/chapters?path=${encodeURIComponent(bookPath)}`);
        const chapters = chaptersData.chapters || [];
        
        // 查找历史进度中播放的章节
        const progressData = await apiRequest(`api/progress?path=${encodeURIComponent(bookPath)}`);
        let startChapter = chapters[0];
        let offset = 0;

        if (progressData.progress) {
          const hist = progressData.progress;
          const found = chapters.find(c => c.path === hist.chapterPath);
          if (found) {
            startChapter = found;
            offset = hist.offset || 0;
          }
        }

        if (startChapter) {
          playChapter(book, startChapter, offset);
        }
      } catch (err) {
        console.error('Failed to resume recently played book:', err);
      }
    });
  }

  async function updateLastPlayedUI() {
    await updateRecentlyPlayed();
  }

  // 触发异步扫描
  async function triggerScan() {
    if (dom.scanBtn.disabled) return;

    try {
      dom.scanBtn.disabled = true;
      dom.scanSpinner.classList.remove('hidden');
      dom.scanBtnText.textContent = '扫描中...';

      await apiRequest('api/scan', { method: 'POST' });
      startScanPolling();
    } catch (err) {
      alert(`启动扫描失败: ${err.message}`);
      resetScanBtn();
    }
  }

  function resetScanBtn() {
    dom.scanBtn.disabled = false;
    dom.scanSpinner.classList.add('hidden');
    dom.scanBtnText.textContent = '扫描书籍';
  }

  // 轮询扫描状态
  function startScanPolling() {
    dom.scanProgressBanner.classList.remove('hidden');
    
    if (state.scanInterval) clearInterval(state.scanInterval);
    state.scanInterval = setInterval(async () => {
      try {
        const progress = await apiRequest('api/scan-status');
        
        dom.progressCount.textContent = progress.booksFound || 0;
        dom.progressFolder.textContent = progress.currentFolder || '/app/audiobook';

        if (progress.status === 'completed') {
          clearInterval(state.scanInterval);
          state.scanInterval = null;
          dom.scanProgressBanner.classList.add('hidden');
          resetScanBtn();
          loadBooks(); // 刷新书籍列表
        } else if (progress.status === 'failed') {
          clearInterval(state.scanInterval);
          state.scanInterval = null;
          dom.scanProgressBanner.classList.add('hidden');
          alert(`扫描失败: ${progress.error || '未知错误'}`);
          resetScanBtn();
        }
      } catch (err) {
        console.error('Polling scan status failed:', err);
      }
    }, 1500);
  }

  // 播放所有/播放全部
  function playAll() {
    if (state.selectedBook && state.selectedBookChapters.length > 0) {
      closeDrawer();
      playChapter(state.selectedBook, state.selectedBookChapters[0]);
    }
  }

  // 初始化事件绑定
  function initEvents() {
    // 搜索和排序
    dom.searchInput.addEventListener('input', filterAndSortBooks);
    dom.sortSelect.addEventListener('change', filterAndSortBooks);

    // 扫描
    dom.scanBtn.addEventListener('click', triggerScan);

    // Drawer
    dom.drawerClose.addEventListener('click', closeDrawer);
    dom.drawerOverlay.addEventListener('click', closeDrawer);
    dom.playAllBtn.addEventListener('click', playAll);

    // 播放器控制
    dom.playPauseBtn.addEventListener('click', togglePlay);
    dom.skipBackBtn.addEventListener('click', () => skipTime(-15));
    dom.skipForwardBtn.addEventListener('click', () => skipTime(15));
    dom.nextBtn.addEventListener('click', playNextChapter);
    
    // 进度条拖动
    dom.playerProgressSlider.addEventListener('input', handleProgressSliderInput);
    dom.playerProgressSlider.addEventListener('change', () => saveProgress(true));

    // 音量与静音
    dom.volumeSlider.addEventListener('input', handleVolumeChange);
    dom.volumeMuteBtn.addEventListener('click', toggleMute);

    // HTML5 音频事件
    dom.audio.addEventListener('timeupdate', handleTimeUpdate);
    dom.audio.addEventListener('ended', playNextChapter);
    dom.audio.addEventListener('play', () => {
      state.isPlaying = true;
      updatePlayPauseUI();
    });
    dom.audio.addEventListener('pause', () => {
      state.isPlaying = false;
      updatePlayPauseUI();
    });

    // 倍速菜单切换与选中
    dom.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.speedMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
      dom.speedMenu.classList.add('hidden');
    });

    dom.speedMenu.querySelectorAll('.speed-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const speed = parseFloat(opt.getAttribute('data-speed'));
        selectSpeed(speed);
      });
    });
  }

  // 页面加载入口
  async function init() {
    initEvents();
    
    // 恢复默认音量
    dom.audio.volume = state.volume;
    dom.volumeSlider.value = state.volume * 100;

    await loadBooks();

    // 检查是否有正在运行的扫描任务，防止用户中途刷新网页导致状态丢失
    try {
      const progress = await apiRequest('api/scan-status');
      if (progress.status === 'scanning') {
        startScanPolling();
        dom.scanBtn.disabled = true;
        dom.scanSpinner.classList.remove('hidden');
        dom.scanBtnText.textContent = '扫描中...';
      }
    } catch (e) {
      console.error(e);
    }
  }

  // DOM 就绪后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
