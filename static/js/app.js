// ============================================================
// 有声书插件 — 前端逻辑 (多页面重构版)
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
    
    // 多页面与特性状态
    currentPage: 'home', // 'home' | 'detail' | 'player'
    lastPage: 'home',
    favorites: JSON.parse(localStorage.getItem('audiobook-favorites') || '[]'),
    chaptersSortOrder: 'asc', // 'asc' | 'desc'
    sleepTimeout: null,
    sleepRemainingSeconds: 0,
    sleepTimerInterval: null,
    
    // 临时文件上传数据
    editCoverBase64: null,
    editCoverExt: null
  };

  // DOM 元素引用
  const dom = {
    // 页面容器
    homePage: document.getElementById('home-page'),
    detailPage: document.getElementById('detail-page'),
    playerPage: document.getElementById('player-page'),
    
    // 浮动按钮
    floatingPlayerBtn: document.getElementById('floating-player-btn'),

    // 书架页（Home）
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    scanBtn: document.getElementById('scan-btn'),
    scanSpinner: document.querySelector('#scan-btn .spinner'),
    scanBtnText: document.querySelector('#scan-btn .btn-text'),
    sortSelect: document.getElementById('sort-select'),
    favoriteFilter: document.getElementById('favorite-filter'),
    bookCount: document.getElementById('book-count'),
    scanProgressBanner: document.getElementById('scan-progress-banner'),
    progressCount: document.getElementById('progress-count'),
    progressFolder: document.getElementById('progress-folder'),
    recentSection: document.getElementById('recent-section'),
    recentGrid: document.getElementById('recent-grid'),
    booksGrid: document.getElementById('books-grid'),
    emptyState: document.getElementById('empty-state'),

    // 详情页（Detail）
    detailBackBtn: document.getElementById('detail-back-btn'),
    detailCover: document.getElementById('detail-cover'),
    detailTitle: document.getElementById('detail-title'),
    detailEditBtn: document.getElementById('detail-edit-btn'),
    detailAuthor: document.getElementById('detail-author'),
    detailStats: document.getElementById('detail-stats'),
    detailTagsContainer: document.getElementById('detail-tags-container'),
    detailDesc: document.getElementById('detail-desc'),
    detailPlayAllBtn: document.getElementById('detail-play-all-btn'),
    detailFavBtn: document.getElementById('detail-fav-btn'),
    detailChaptersCount: document.getElementById('detail-chapters-count'),
    chaptersSortToggle: document.getElementById('chapters-sort-toggle'),
    detailChapterList: document.getElementById('detail-chapter-list'),

    // 播放页（Player）
    playerBackBtn: document.getElementById('player-back-btn'),
    vinylDisc: document.getElementById('vinyl-disc'),
    playerCover: document.getElementById('player-cover'),
    playerBookTitle: document.getElementById('player-book-title'),
    playerChapterTitle: document.getElementById('player-chapter-title'),
    playerTimeCurrent: document.getElementById('player-time-current'),
    playerProgressSlider: document.getElementById('player-progress-slider'),
    playerTimeDuration: document.getElementById('player-time-duration'),
    skipBackBtn: document.getElementById('skip-back-btn'),
    prevBtn: document.getElementById('prev-btn'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    svgPlay: document.getElementById('svg-play'),
    svgPause: document.getElementById('svg-pause'),
    nextBtn: document.getElementById('next-btn'),
    skipForwardBtn: document.getElementById('skip-forward-btn'),
    speedBtn: document.getElementById('speed-btn'),
    speedMenu: document.getElementById('speed-menu'),
    sleepTimerBtn: document.getElementById('sleep-timer-btn'),
    sleepMenu: document.getElementById('sleep-menu'),
    quickListBtn: document.getElementById('quick-list-btn'),

    // 编辑书籍 Modal
    editModalOverlay: document.getElementById('edit-modal-overlay'),
    editModalClose: document.getElementById('edit-modal-close'),
    editBookTitle: document.getElementById('edit-book-title'),
    editBookAuthor: document.getElementById('edit-book-author'),
    editBookDesc: document.getElementById('edit-book-desc'),
    editBookType: document.getElementById('edit-book-type'),
    editBookTags: document.getElementById('edit-book-tags'),
    editCoverPreview: document.getElementById('edit-cover-preview'),
    editCoverUrl: document.getElementById('edit-cover-url'),
    fileSelectTrigger: document.getElementById('file-select-trigger'),
    editCoverFile: document.getElementById('edit-cover-file'),
    selectedFilename: document.getElementById('selected-filename'),
    editModalCancel: document.getElementById('edit-modal-cancel'),
    editModalSave: document.getElementById('edit-modal-save'),

    // 播放列表 Overlay
    quickListOverlay: document.getElementById('quick-list-overlay'),
    quickListClose: document.getElementById('quick-list-close'),
    playerChapterList: document.getElementById('player-chapter-list'),

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

  // 页面导航控制
  function navigateTo(pageName) {
    state.lastPage = state.currentPage;
    state.currentPage = pageName;
    
    // 隐藏所有页面
    dom.homePage.classList.add('hidden');
    dom.detailPage.classList.add('hidden');
    dom.playerPage.classList.add('hidden');
    
    // 显示目标页面
    if (pageName === 'home') {
      dom.homePage.classList.remove('hidden');
    } else if (pageName === 'detail') {
      dom.detailPage.classList.remove('hidden');
    } else if (pageName === 'player') {
      dom.playerPage.classList.remove('hidden');
    }

    // 浮动播放按钮在播放页隐藏，有音频加载时在其他页面显示
    updateFloatingPlayerBtnVisibility();
  }

  function updateFloatingPlayerBtnVisibility() {
    if (state.currentPage === 'player') {
      dom.floatingPlayerBtn.classList.add('hidden');
    } else if (state.currentChapter) {
      dom.floatingPlayerBtn.classList.remove('hidden');
    } else {
      dom.floatingPlayerBtn.classList.add('hidden');
    }
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

  // 获取带 Token 认证的封面图片 URL
  function getAuthenticatedCoverUrl(coverPath) {
    if (!coverPath) return './static/css/placeholder-cover.svg';
    
    // 如果已经是 data URL 或 http/https URL，直接返回
    if (coverPath.startsWith('data:') || coverPath.startsWith('http://') || coverPath.startsWith('https://')) {
      return coverPath;
    }
    
    let token = '';
    try {
      const authData = JSON.parse(localStorage.getItem('songloft-auth') || '{}');
      if (authData.accessToken) {
        token = authData.accessToken;
      }
    } catch (e) {}

    let url = `files/${coverPath.replace(/^\/+/, '')}`;
    if (token) {
      url += `?access_token=${encodeURIComponent(token)}`;
    }
    return url;
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
    const rawVal = dom.searchInput.value;
    const query = rawVal.trim().toLowerCase();
    state.searchQuery = query;

    // 显示或隐藏快速删除（清空）按钮
    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) {
      if (rawVal.length > 0) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
    }

    const showOnlyFav = dom.favoriteFilter.checked;

    state.filteredBooks = state.books.filter(book => {
      // 搜索过滤
      const matchesSearch = (
        book.title.toLowerCase().includes(query) ||
        book.author.toLowerCase().includes(query) ||
        (book.description && book.description.toLowerCase().includes(query))
      );
      
      // 收藏过滤
      const matchesFav = !showOnlyFav || isBookFavorite(book.path);
      
      return matchesSearch && matchesFav;
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
      const coverUrl = getAuthenticatedCoverUrl(book.cover);

      return `
        <div class="book-card" data-path="${encodeURIComponent(book.path)}">
          <img class="book-cover" src="${coverUrl}" alt="${book.title}" onerror="this.onerror=null; this.src='./static/css/placeholder-cover.svg'">
          <div class="book-overlay">
            <div class="book-title" title="${book.title}">${book.title}</div>
            <div class="book-info-text">${book.chapterCount} 章节 · ${formatSize(book.totalSize)}</div>
          </div>
        </div>
      `;
    }).join('');

    // 绑定卡片点击事件
    dom.booksGrid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => {
        const bookPath = decodeURIComponent(card.getAttribute('data-path'));
        openBookDetail(bookPath);
      });
    });
  }

  // 收藏特性逻辑
  function isBookFavorite(bookPath) {
    return state.favorites.includes(bookPath);
  }

  function toggleBookFavorite(bookPath) {
    const idx = state.favorites.indexOf(bookPath);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
    } else {
      state.favorites.push(bookPath);
    }
    localStorage.setItem('audiobook-favorites', JSON.stringify(state.favorites));
    updateFavButtonUI();
    filterAndSortBooks(); // 刷新书架（如果开启了只看收藏）
  }

  function updateFavButtonUI() {
    if (!state.selectedBook) return;
    const isFav = isBookFavorite(state.selectedBook.path);
    if (isFav) {
      dom.detailFavBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="svg-icon-small" style="color: var(--primary);"><path fill="currentColor" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>
        <span>已收藏</span>
      `;
      dom.detailFavBtn.classList.remove('btn-outline');
    } else {
      dom.detailFavBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="svg-icon-small"><path fill="currentColor" d="M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66L12,15.39M22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z"/></svg>
        <span>收藏</span>
      `;
      dom.detailFavBtn.classList.add('btn-outline');
    }
  }

  // 打开书籍详情页面
  async function openBookDetail(bookPath) {
    const book = state.books.find(b => b.path === bookPath);
    if (!book) return;

    state.selectedBook = book;
    
    // 设置详情页元数据
    dom.detailCover.src = getAuthenticatedCoverUrl(book.cover);
    dom.detailTitle.textContent = book.title;
    dom.detailAuthor.textContent = book.author || '未知作者';
    
    const typeLabel = book.type || '默认';
    dom.detailStats.textContent = `${book.chapterCount} 章节 · ${formatSize(book.totalSize)} · ${typeLabel}`;
    dom.detailDesc.textContent = book.description || '暂无简介';

    // 渲染标签
    dom.detailTagsContainer.innerHTML = '';
    if (book.tags && book.tags.length > 0) {
      dom.detailTagsContainer.innerHTML = book.tags.map(t => `<span class="tag-badge">${t}</span>`).join('');
    }

    updateFavButtonUI();

    // 跳转到详情页面
    navigateTo('detail');

    // 渲染加载态章节列表
    dom.detailChapterList.innerHTML = '<div style="padding: 20px; text-align: center;">加载章节中...</div>';

    try {
      // 获取章节列表
      const chaptersData = await apiRequest(`api/chapters?path=${encodeURIComponent(bookPath)}`);
      state.selectedBookChapters = chaptersData.chapters || [];
      dom.detailChaptersCount.textContent = state.selectedBookChapters.length;

      // 获取各章节的播放进度
      const progressData = await apiRequest(`api/progress?path=${encodeURIComponent(bookPath)}`).catch(() => ({}));
      const progress = progressData.progress || {};

      renderChapters(progress);
    } catch (err) {
      dom.detailChapterList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--error);">获取章节失败: ${err.message}</div>`;
    }
  }

  // 切换详情页章节排序
  function toggleChaptersSort() {
    state.chaptersSortOrder = state.chaptersSortOrder === 'asc' ? 'desc' : 'asc';
    
    // 更新排序按钮 UI
    const sortText = dom.chaptersSortToggle.querySelector('.sort-text');
    const sortIcon = dom.chaptersSortToggle.querySelector('svg');
    if (state.chaptersSortOrder === 'asc') {
      sortText.textContent = '正序';
      sortIcon.className.baseVal = 'svg-icon-small sort-icon-asc';
      sortIcon.style.transform = 'none';
    } else {
      sortText.textContent = '倒序';
      sortIcon.className.baseVal = 'svg-icon-small sort-icon-desc';
      sortIcon.style.transform = 'rotate(180deg)';
    }

    // 重新获取进度并渲染
    if (state.selectedBook) {
      apiRequest(`api/progress?path=${encodeURIComponent(state.selectedBook.path)}`)
        .then(progressData => {
          renderChapters(progressData.progress || {});
        })
        .catch(() => renderChapters({}));
    }
  }

  // 渲染详情页的章节列表
  function renderChapters(bookProgress) {
    if (state.selectedBookChapters.length === 0) {
      dom.detailChapterList.innerHTML = '<div style="padding: 20px; text-align: center;">此书籍无音频文件</div>';
      return;
    }

    // 复制数组并依序排序
    const sortedChapters = [...state.selectedBookChapters];
    if (state.chaptersSortOrder === 'desc') {
      sortedChapters.reverse();
    }

    dom.detailChapterList.innerHTML = sortedChapters.map((chapter, idx) => {
      const isCurrentActive = state.currentChapter && state.currentChapter.path === chapter.path;
      
      // 计算本章节的进度条百分比 (若有历史进度)
      let progressPercent = 0;
      let progressText = '';
      if (isCurrentActive && dom.audio.duration) {
        progressPercent = (dom.audio.currentTime / dom.audio.duration) * 100;
        progressText = `已听 ${formatDuration(dom.audio.currentTime)}`;
      } else if (bookProgress && bookProgress.chapterPath === chapter.path) {
        const offset = bookProgress.offset || 0;
        const dur = bookProgress.duration || 1;
        progressPercent = (offset / dur) * 100;
        progressText = `已听 ${formatDuration(offset)}`;
      }

      // 计算排序后的正确索引号展示 (正序/倒序保持原有章节序号)
      let displayIdx = idx + 1;
      if (state.chaptersSortOrder === 'desc') {
        displayIdx = sortedChapters.length - idx;
      }
      const padIdx = String(displayIdx).padStart(3, '0');

      return `
        <div class="chapter-item ${isCurrentActive ? 'active' : ''}" data-path="${encodeURIComponent(chapter.path)}">
          <div class="chapter-left">
            <span class="chapter-title" title="${chapter.name}">${chapter.name}</span>
            <div class="chapter-meta">
              <span>序号: ${padIdx} · 大小: ${formatSize(chapter.size)}</span>
              ${progressPercent > 0 ? `
                <span class="progress-bar-mini">
                  <span class="progress-fill-mini" style="width: ${progressPercent}%"></span>
                </span>
                <span>${progressText}</span>
              ` : ''}
            </div>
          </div>
          <div class="chapter-right">
            <svg viewBox="0 0 24 24" class="svg-icon-small" style="width: 16px; height: 16px;"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>
          </div>
        </div>
      `;
    }).join('');

    // 绑定点击播放事件
    dom.detailChapterList.querySelectorAll('.chapter-item').forEach(item => {
      item.addEventListener('click', () => {
        const path = decodeURIComponent(item.getAttribute('data-path'));
        const chapter = state.selectedBookChapters.find(c => c.path === path);
        if (chapter) {
          playChapter(state.selectedBook, chapter);
        }
      });
    });
  }

  // 开始播放特定章节并开启播放页
  async function playChapter(book, chapter, restoreOffset = null) {
    state.currentBook = book;
    state.currentChapter = chapter;

    // 更新播放器界面上的元数据
    dom.playerBookTitle.textContent = book.title;
    dom.playerChapterTitle.textContent = chapter.name;
    
    dom.playerCover.src = getAuthenticatedCoverUrl(book.cover);

    // 获取并设置带 Auth Token 的播放流地址
    let token = '';
    try {
      const authData = JSON.parse(localStorage.getItem('songloft-auth') || '{}');
      if (authData.accessToken) {
        token = authData.accessToken;
      }
    } catch (e) {}

    let audioUrl = `api/stream?path=${encodeURIComponent(chapter.path)}`;
    if (token) {
      audioUrl += `&access_token=${encodeURIComponent(token)}`;
    }
    
    dom.audio.src = audioUrl;
    dom.audio.playbackRate = state.speed;
    dom.audio.volume = state.isMuted ? 0 : state.volume;

    // 恢复播放历史进度
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
      const performSeek = () => {
        try {
          dom.audio.currentTime = offsetToSeek;
        } catch (e) {
          console.error('Seek error:', e);
        }
        dom.audio.removeEventListener('loadedmetadata', performSeek);
        dom.audio.removeEventListener('canplay', performSeek);
        dom.audio.removeEventListener('playing', performSeek);
      };
      dom.audio.addEventListener('loadedmetadata', performSeek);
      dom.audio.addEventListener('canplay', performSeek);
      dom.audio.addEventListener('playing', performSeek);
    }

    // 开始播放并切入播放页面
    dom.audio.play()
      .then(() => {
        state.isPlaying = true;
        updatePlayPauseUI();
      })
      .catch(err => {
        console.error('Playback failed:', err);
      });

    navigateTo('player');
    
    // 更新最近播放记录和浮动按钮
    updateRecentlyPlayed();

    // 如果详情页打开了同本书，重新加载章节进度条
    if (state.selectedBook && state.selectedBook.path === book.path) {
      const progressData = await apiRequest(`api/progress?path=${encodeURIComponent(book.path)}`).catch(() => ({}));
      renderChapters(progressData.progress);
    }
  }

  // 播放全部
  function playAll() {
    if (state.selectedBook && state.selectedBookChapters.length > 0) {
      playChapter(state.selectedBook, state.selectedBookChapters[0]);
    }
  }

  // 播放暂停切换
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
    saveProgress(true); // 立即保存进度
  }

  function updatePlayPauseUI() {
    if (state.isPlaying) {
      dom.svgPlay.classList.add('hidden');
      dom.svgPause.classList.remove('hidden');
      dom.vinylDisc.classList.add('playing');
    } else {
      dom.svgPlay.classList.remove('hidden');
      dom.svgPause.classList.add('hidden');
      dom.vinylDisc.classList.remove('playing');
    }
    updateFloatingPlayerBtnVisibility();
  }

  // 15 秒快退/快进
  function skipTime(seconds) {
    if (!state.currentChapter) return;
    dom.audio.currentTime = Math.max(0, Math.min(dom.audio.duration || 0, dom.audio.currentTime + seconds));
    updateProgressUI();
    saveProgress(true);
  }

  // 播放前一章 / 下一章
  function playPrevChapter() {
    if (!state.currentBook || !state.currentChapter) return;
    
    const triggerPrev = (chapters) => {
      const currentIdx = chapters.findIndex(c => c.path === state.currentChapter.path);
      if (currentIdx > 0) {
        playChapter(state.currentBook, chapters[currentIdx - 1]);
      } else {
        alert('已经是第一章了');
      }
    };

    if (state.selectedBook && state.selectedBook.path === state.currentBook.path && state.selectedBookChapters.length > 0) {
      triggerPrev(state.selectedBookChapters);
    } else {
      apiRequest(`api/chapters?path=${encodeURIComponent(state.currentBook.path)}`)
        .then(data => triggerPrev(data.chapters || []))
        .catch(console.error);
    }
  }

  function playNextChapter() {
    if (!state.currentBook || !state.currentChapter) return;
    
    const triggerNext = (chapters) => {
      const currentIdx = chapters.findIndex(c => c.path === state.currentChapter.path);
      if (currentIdx >= 0 && currentIdx < chapters.length - 1) {
        playChapter(state.currentBook, chapters[currentIdx + 1]);
      } else {
        alert('已经播放到最后一章');
        state.isPlaying = false;
        updatePlayPauseUI();
      }
    };

    if (state.selectedBook && state.selectedBook.path === state.currentBook.path && state.selectedBookChapters.length > 0) {
      triggerNext(state.selectedBookChapters);
    } else {
      apiRequest(`api/chapters?path=${encodeURIComponent(state.currentBook.path)}`)
        .then(data => triggerNext(data.chapters || []))
        .catch(console.error);
    }
  }

  // 倍速控制
  function selectSpeed(speed) {
    state.speed = speed;
    dom.speedBtn.textContent = `${speed}x`;
    dom.audio.playbackRate = speed;
    dom.speedMenu.classList.add('hidden');
    
    dom.speedMenu.querySelectorAll('.speed-option').forEach(opt => {
      const val = parseFloat(opt.getAttribute('data-speed'));
      opt.classList.toggle('active', val === speed);
    });
  }

  // 睡眠定时器控制
  function selectSleepTimer(minutes) {
    // 清理现有定时器
    if (state.sleepTimeout) clearTimeout(state.sleepTimeout);
    if (state.sleepTimerInterval) clearInterval(state.sleepTimerInterval);
    state.sleepTimeout = null;
    state.sleepTimerInterval = null;
    
    dom.sleepMenu.classList.add('hidden');
    
    dom.sleepMenu.querySelectorAll('.sleep-option').forEach(opt => {
      const val = parseInt(opt.getAttribute('data-minutes'));
      opt.classList.toggle('active', val === minutes);
    });

    if (minutes === 0) {
      dom.sleepTimerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="svg-icon"><path fill="currentColor" d="M12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2M12.5 7V12.25L17 14.92L16.25 16.15L11 13V7H12.5Z"/></svg>
      `;
      return;
    }

    state.sleepRemainingSeconds = minutes * 60;
    updateSleepTimerUI();

    // 开启秒倒计时
    state.sleepTimerInterval = setInterval(() => {
      state.sleepRemainingSeconds--;
      if (state.sleepRemainingSeconds <= 0) {
        clearInterval(state.sleepTimerInterval);
        state.sleepTimerInterval = null;
      }
      updateSleepTimerUI();
    }, 1000);

    // 定时结束暂停播放
    state.sleepTimeout = setTimeout(() => {
      if (state.isPlaying) {
        dom.audio.pause();
        state.isPlaying = false;
        updatePlayPauseUI();
        saveProgress(true);
      }
      selectSleepTimer(0); // 重置状态
      alert('睡眠定时结束，已暂停播放');
    }, minutes * 60 * 1000);
  }

  function updateSleepTimerUI() {
    if (state.sleepRemainingSeconds <= 0) {
      dom.sleepTimerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="svg-icon"><path fill="currentColor" d="M12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2M12.5 7V12.25L17 14.92L16.25 16.15L11 13V7H12.5Z"/></svg>
      `;
      return;
    }
    const mins = Math.floor(state.sleepRemainingSeconds / 60);
    const secs = state.sleepRemainingSeconds % 60;
    dom.sleepTimerBtn.innerHTML = `<span style="font-size: 11px; font-weight: bold;">${mins}:${String(secs).padStart(2, '0')}</span>`;
  }

  // 弹出播放列表 Overlay (Player 界面快速选集)
  async function openQuickChapterList() {
    if (!state.currentBook) return;

    dom.playerChapterList.innerHTML = '<div style="padding: 20px; text-align: center;">加载章节中...</div>';
    dom.quickListOverlay.classList.remove('hidden');

    try {
      const chaptersData = await apiRequest(`api/chapters?path=${encodeURIComponent(state.currentBook.path)}`);
      const chapters = chaptersData.chapters || [];

      dom.playerChapterList.innerHTML = chapters.map((chapter, idx) => {
        const isCurrentActive = state.currentChapter && state.currentChapter.path === chapter.path;
        const padIdx = String(idx + 1).padStart(3, '0');

        return `
          <div class="chapter-item ${isCurrentActive ? 'active' : ''}" data-path="${encodeURIComponent(chapter.path)}">
            <div class="chapter-left">
              <span class="chapter-title" title="${chapter.name}">${chapter.name}</span>
              <div class="chapter-meta">
                <span>序号: ${padIdx} · 大小: ${formatSize(chapter.size)}</span>
              </div>
            </div>
            <div class="chapter-right">
              <svg viewBox="0 0 24 24" class="svg-icon-small" style="width: 16px; height: 16px;"><path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/></svg>
            </div>
          </div>
        `;
      }).join('');

      // 绑定点击切换事件
      dom.playerChapterList.querySelectorAll('.chapter-item').forEach(item => {
        item.addEventListener('click', () => {
          const path = decodeURIComponent(item.getAttribute('data-path'));
          const chapter = chapters.find(c => c.path === path);
          if (chapter) {
            dom.quickListOverlay.classList.add('hidden');
            playChapter(state.currentBook, chapter);
          }
        });
      });
    } catch (err) {
      dom.playerChapterList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--error);">获取章节失败</div>`;
    }
  }

  // 进度事件更新
  function handleTimeUpdate() {
    updateProgressUI();
    
    // 自动备份播放进度：每 8 秒向后端同步一次
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

  // 拖拽进度条
  function handleProgressSliderInput() {
    const duration = dom.audio.duration || 0;
    if (duration > 0) {
      const seekTo = (dom.playerProgressSlider.value / 100) * duration;
      dom.audio.currentTime = seekTo;
      dom.playerTimeCurrent.textContent = formatDuration(seekTo);
    }
  }

  // 向宿主同步进度
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

  // 最近播放列表渲染
  async function updateRecentlyPlayed() {
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

    const lastBook = state.books.find(b => b.path === state.lastPlayed.bookPath);
    if (!lastBook) {
      dom.recentSection.classList.add('hidden');
      return;
    }

    dom.recentSection.classList.remove('hidden');

    const coverUrl = getAuthenticatedCoverUrl(lastBook.cover);

    dom.recentGrid.innerHTML = `
      <div class="recent-card" data-book-path="${encodeURIComponent(lastBook.path)}">
        <img class="book-cover-mini" src="${coverUrl}" alt="" onerror="this.onerror=null; this.src='./static/css/placeholder-cover.svg'">
        <div class="recent-card-info">
          <h3>${lastBook.title}</h3>
          <div class="chapter-name">${state.lastPlayed.chapterName || '未知章节'}</div>
        </div>
      </div>
    `;

    // 绑定最近卡片点击事件：自动加载详情页，获取最新进度恢复播放
    dom.recentGrid.querySelector('.recent-card').addEventListener('click', async () => {
      const bookPath = decodeURIComponent(dom.recentGrid.querySelector('.recent-card').getAttribute('data-book-path'));
      const book = state.books.find(b => b.path === bookPath);
      if (!book) return;

      try {
        const chaptersData = await apiRequest(`api/chapters?path=${encodeURIComponent(bookPath)}`);
        const chapters = chaptersData.chapters || [];
        
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

  // 书籍信息编辑 Modal 逻辑
  function openEditModal() {
    if (!state.selectedBook) return;
    
    const book = state.selectedBook;
    
    dom.editBookTitle.value = book.title || '';
    dom.editBookAuthor.value = book.author || '';
    dom.editBookDesc.value = book.description || '';
    dom.editBookType.value = book.type || '默认';
    dom.editBookTags.value = book.tags ? book.tags.join(', ') : '';
    
    dom.editCoverPreview.src = getAuthenticatedCoverUrl(book.cover);
    dom.editCoverUrl.value = book.cover || '';
    
    // 清理临时文件上传变量
    state.editCoverBase64 = null;
    state.editCoverExt = null;
    dom.editCoverFile.value = '';
    dom.selectedFilename.textContent = '未选择文件';

    dom.editModalOverlay.classList.remove('hidden');
  }

  function closeEditModal() {
    dom.editModalOverlay.classList.add('hidden');
  }

  // 选择上传文件的文件事件
  function handleCoverFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    dom.selectedFilename.textContent = file.name;
    
    // 提取扩展名
    const dotIdx = file.name.lastIndexOf('.');
    state.editCoverExt = dotIdx >= 0 ? file.name.slice(dotIdx + 1).toLowerCase() : 'jpg';

    // 转为 Base64 读取预览
    const reader = new FileReader();
    reader.onload = function(evt) {
      const dataUrl = evt.target.result;
      dom.editCoverPreview.src = dataUrl;
      
      // 去掉 data:image/xxx;base64, 前缀
      const base64Content = dataUrl.slice(dataUrl.indexOf(';base64,') + 8);
      state.editCoverBase64 = base64Content;
    };
    reader.readAsDataURL(file);
  }

  // 保存书籍信息修改
  async function saveBookEdit() {
    if (!state.selectedBook) return;

    const payload = {
      path: state.selectedBook.path,
      title: dom.editBookTitle.value.trim(),
      author: dom.editBookAuthor.value.trim(),
      description: dom.editBookDesc.value.trim(),
      type: dom.editBookType.value.trim(),
      tags: dom.editBookTags.value.trim(),
      coverUrl: dom.editCoverUrl.value.trim(),
      coverBase64: state.editCoverBase64,
      coverExt: state.editCoverExt
    };

    if (!payload.title) {
      alert('书名不能为空');
      return;
    }

    try {
      dom.editModalSave.disabled = true;
      dom.editModalSave.textContent = '保存中...';

      await apiRequest('api/books/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      closeEditModal();
      
      // 重新加载书籍列表并刷新详情界面
      await loadBooks();
      openBookDetail(state.selectedBook.path);
    } catch (err) {
      alert(`保存失败: ${err.message}`);
    } finally {
      dom.editModalSave.disabled = false;
      dom.editModalSave.textContent = '保存';
    }
  }

  // 触发异步扫描
  async function triggerScan() {
    if (dom.scanBtn.disabled) return;

    try {
      dom.scanBtn.disabled = true;
      dom.scanSpinner.classList.remove('hidden');
      dom.scanBtnText.textContent = '加载中';

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
    dom.scanBtnText.textContent = '加载';
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
          loadBooks(); // 刷新书籍
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

  // 初始化事件绑定
  function initEvents() {
    // 搜索和过滤
    dom.searchInput.addEventListener('input', filterAndSortBooks);
    dom.sortSelect.addEventListener('change', filterAndSortBooks);
    dom.favoriteFilter.addEventListener('change', filterAndSortBooks);

    const clearBtn = document.getElementById('search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        dom.searchInput.value = '';
        filterAndSortBooks();
        dom.searchInput.focus();
      });
    }

    // 扫描
    dom.scanBtn.addEventListener('click', triggerScan);

    // 返回按钮
    dom.detailBackBtn.addEventListener('click', () => navigateTo('home'));
    dom.playerBackBtn.addEventListener('click', () => navigateTo(state.lastPage));
    
    // 浮动耳机播放按钮
    dom.floatingPlayerBtn.addEventListener('click', () => {
      if (state.currentChapter) {
        navigateTo('player');
      }
    });

    // 详情页功能
    dom.detailPlayAllBtn.addEventListener('click', playAll);
    dom.detailFavBtn.addEventListener('click', () => {
      if (state.selectedBook) {
        toggleBookFavorite(state.selectedBook.path);
      }
    });
    dom.chaptersSortToggle.addEventListener('click', toggleChaptersSort);

    // 播放器控制
    dom.playPauseBtn.addEventListener('click', togglePlay);
    dom.skipBackBtn.addEventListener('click', () => skipTime(-15));
    dom.skipForwardBtn.addEventListener('click', () => skipTime(15));
    dom.prevBtn.addEventListener('click', playPrevChapter);
    dom.nextBtn.addEventListener('click', playNextChapter);
    
    // 进度条拖动
    dom.playerProgressSlider.addEventListener('input', handleProgressSliderInput);
    dom.playerProgressSlider.addEventListener('change', () => saveProgress(true));

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
      dom.sleepMenu.classList.add('hidden');
    });

    dom.speedMenu.querySelectorAll('.speed-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const speed = parseFloat(opt.getAttribute('data-speed'));
        selectSpeed(speed);
      });
    });

    // 睡眠菜单切换与选中
    dom.sleepTimerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.sleepMenu.classList.toggle('hidden');
      dom.speedMenu.classList.add('hidden');
    });

    dom.sleepMenu.querySelectorAll('.sleep-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const mins = parseInt(opt.getAttribute('data-minutes'));
        selectSleepTimer(mins);
      });
    });

    // 播放列表遮罩与浮窗
    dom.quickListBtn.addEventListener('click', openQuickChapterList);
    dom.quickListClose.addEventListener('click', () => dom.quickListOverlay.classList.add('hidden'));
    dom.quickListOverlay.addEventListener('click', (e) => {
      if (e.target === dom.quickListOverlay) {
        dom.quickListOverlay.classList.add('hidden');
      }
    });

    // 书籍编辑 Modal 事件
    dom.detailEditBtn.addEventListener('click', openEditModal);
    dom.editModalClose.addEventListener('click', closeEditModal);
    dom.editModalCancel.addEventListener('click', closeEditModal);
    dom.editModalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.editModalOverlay) closeEditModal();
    });
    dom.editModalSave.addEventListener('click', saveBookEdit);
    
    // 编辑选择文件代理
    dom.fileSelectTrigger.addEventListener('click', () => dom.editCoverFile.click());
    dom.editCoverFile.addEventListener('change', handleCoverFileSelected);

    // 全局点击收起菜单
    document.addEventListener('click', () => {
      dom.speedMenu.classList.add('hidden');
      dom.sleepMenu.classList.add('hidden');
    });
  }

  // 页面加载入口
  async function init() {
    initEvents();
    
    // 初始化默认状态
    dom.audio.volume = state.volume;

    await loadBooks();

    // 检查是否有正在运行的扫描任务
    try {
      const progress = await apiRequest('api/scan-status');
      if (progress.status === 'scanning') {
        startScanPolling();
        dom.scanBtn.disabled = true;
        dom.scanSpinner.classList.remove('hidden');
        dom.scanBtnText.textContent = '加载中';
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
