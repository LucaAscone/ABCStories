import {
  Component, OnInit, OnDestroy, Inject, PLATFORM_ID,
  HostListener, signal, computed, ChangeDetectorRef, inject,
  ViewChild, ElementRef
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../services/api';
import { AuthService } from '../../services/auth.service';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-reader',
  imports: [CommonModule],
  templateUrl: './reader.html',
  styleUrl: './reader.scss',
})
export class Reader implements OnInit, OnDestroy {

  chapter: any = null;
  chapters = signal<any[]>([]);
  isLoading = true;
  error: string | null = null;

  currentUser = inject(AuthService).currentUser;
  private dialogService = inject(DialogService);

  readingFontClass = computed(() => {
    const user = this.currentUser();
    const font = (user as any)?.reading_font || 'sans-serif';
    return `font-${font}`;
  });

  readingFontSizeClass = computed(() => {
    const user = this.currentUser();
    const size = (user as any)?.reading_font_size || 'medium';
    return `size-${size}`;
  });

  readingWidthClass = computed(() => {
    const user = this.currentUser();
    const width = (user as any)?.reading_width || 'medium';
    return `width-${width}`;
  });

  readingModeClass = computed(() => {
    const user = this.currentUser();
    return `mode-${(user as any)?.reading_mode || 'scroll'}`;
  });

  isPageMode = computed(() => {
    const user = this.currentUser();
    return (user as any)?.reading_mode === 'page';
  });

  currentPage = signal(1);
  totalPages = signal(1);

  updatePageCount(el: HTMLElement) {
    if (!el) return;
    const w = el.clientWidth;
    const s = el.scrollWidth;
    if (w > 0) {
      this.totalPages.set(Math.max(1, Math.round(s / w)));
      this.currentPage.set(Math.max(1, Math.round(el.scrollLeft / w) + 1));
    }
  }

  scrollPage(direction: number) {
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.querySelector('.reader-text') as HTMLElement;
    if (el) {
      const w = el.clientWidth;
      el.scrollBy({
        left: direction * w,
        behavior: 'smooth'
      });
    }
  }

  onReaderTextScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.updatePageCount(el);

    const user = this.currentUser();
    if ((user as any)?.reading_mode !== 'page') return;

    const scrolled = el.scrollLeft;
    const total = el.scrollWidth - el.clientWidth;
    const pct = total > 0 ? Math.round((scrolled / total) * 100) : 0;
    this.updateScrollPercent(pct);
  }

  // Sidebar capitoli
  sidebarOpen = false;

  // Progresso scroll nel capitolo corrente (0-100)
  scrollPercent = signal(0);
  isScrolled = signal(false);
  isPastTitle = signal(false);

  // Progresso di tutti i capitoli
  chapterProgress = signal<{ [key: string]: number }>({});
  private lastSavedPercent = -1;
  private saveDebounceTimer: any = null;

  getChapterProgress(chapterId: string): number {
    if (this.chapter && this.chapter.id === chapterId) {
      return this.scrollPercent();
    }
    return this.chapterProgress()[chapterId] ?? 0;
  }

  updateScrollPercent(pct: number) {
    const finalPct = Math.min(100, Math.max(0, pct));

    // Only allow progress to increase (never decrease, unless reset by "Rileggi")
    const currentPct = this.scrollPercent();
    if (finalPct <= currentPct) {
      this.cdr.detectChanges(); // Ensure the scroll position updates are fully handled
      return;
    }

    this.scrollPercent.set(finalPct);

    if (this.chapter) {
      const current = { ...this.chapterProgress() };
      current[this.chapter.id] = finalPct;
      this.chapterProgress.set(current);
    }

    if (finalPct !== this.lastSavedPercent) {
      if (finalPct === 100 || finalPct === 0) {
        this.persistProgress();
      } else {
        this.scheduleDebouncedSave();
      }
    }
    this.cdr.detectChanges(); // Ensure UI is updated instantly
  }

  private scheduleDebouncedSave() {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.persistProgress();
    }, 2000);
  }

  private scrollToPercent(pct: number): void {
    if (!isPlatformBrowser(this.platformId) || pct <= 0) return;
    setTimeout(() => {
      if (this.isPageMode()) {
        const el = document.querySelector('.reader-text') as HTMLElement;
        if (el) {
          const total = el.scrollWidth - el.clientWidth;
          if (total > 0) {
            el.scrollLeft = Math.round((pct / 100) * total);
            this.updatePageCount(el);
          }
        }
      } else {
        const el = document.documentElement;
        const total = el.scrollHeight - el.clientHeight;
        if (total > 0) {
          window.scrollTo({
            top: Math.round((pct / 100) * total),
            behavior: 'instant'
          });
        }
      }
    }, 150);
  }

  // Progresso globale calcolato
  globalPercent = computed(() => {
    const chs = this.chapters();
    if (!chs.length) return 0;
    let totalProgress = 0;
    const currentProgress = this.chapterProgress();
    for (const ch of chs) {
      if (this.chapter && ch.id === this.chapter.id) {
        totalProgress += this.scrollPercent();
      } else {
        totalProgress += currentProgress[ch.id] ?? 0;
      }
    }
    return Math.round(totalProgress / chs.length);
  });
  private storyId: string = '';

  // Sottolineature
  chapterHighlights: any[] = [];
  paragraphsWithSegments: any[] = [];
  activeSelection: any = null;
  selectedHighlightToDelete: any = null;

  // Touch drawing state (Mobile Swipe-to-Highlight)
  private readerTextElement: HTMLElement | null = null;
  private touchStartPos: { x: number; y: number } | null = null;
  private touchParagraphIndex: number | null = null;
  private touchStartOffset: number | null = null;
  private minTouchOffset: number | null = null;
  private maxTouchOffset: number | null = null;
  private touchParagraphEl: HTMLElement | null = null;
  private isDrawingHighlight = false;
  private isTouchScrolling = false;

  private longPressTimeout: any = null;
  private lastTouchTime = 0;
  private touchStartTime = 0;
  isDraggingHandle = false;
  private draggedHandleType: 'start' | 'end' | null = null;
  private justSelectedWord = false;

  private boundTouchStart = this.handleTouchStart.bind(this);
  private boundTouchMove = this.handleTouchMove.bind(this);
  private boundTouchEnd = this.handleTouchEnd.bind(this);
  private boundHandleTouchMove = this.handleHandleTouchMove.bind(this);
  private boundHandleTouchEnd = this.handleHandleTouchEnd.bind(this);

  @ViewChild('readerText') set readerText(elementRef: ElementRef<HTMLElement> | undefined) {
    if (elementRef) {
      this.readerTextElement = elementRef.nativeElement;
      this.setupTouchListeners();
    } else {
      this.cleanupTouchListeners();
      this.readerTextElement = null;
    }
  }
  floatingBtnStyle = {
    display: 'none',
    top: '0px',
    left: '0px'
  };

  highlightModeActive: boolean = false;
  selectedColor: string = 'rgba(241, 196, 15, 0.3)';

  hoveredHighlightId: string | null = null;
  activeHighlightId: string | null = null;
  shareMenuOpenForHighlightId: string | null = null;
  activeShareHighlight: any = null;
  private hoverTimeout: any = null;

  highlightColors = [
    { name: 'Giallo', value: 'rgba(241, 196, 15, 0.3)', textShadow: 'rgba(241, 196, 15, 0.6)' },
    { name: 'Verde', value: 'rgba(46, 204, 113, 0.3)', textShadow: 'rgba(46, 204, 113, 0.6)' },
    { name: 'Rosso', value: 'rgba(231, 76, 60, 0.3)', textShadow: 'rgba(231, 76, 60, 0.6)' },
    { name: 'Blu', value: 'rgba(52, 152, 219, 0.3)', textShadow: 'rgba(52, 152, 219, 0.6)' },
    { name: 'Viola', value: 'rgba(155, 89, 182, 0.3)', textShadow: 'rgba(155, 89, 182, 0.6)' }
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: Api,
    private auth: AuthService,
    private cdr: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object
  ) { }

  private highlightIdToScroll: string | null = null;

  ngOnInit(): void {
    this.route.queryParams.subscribe(queryParams => {
      this.highlightIdToScroll = queryParams['highlightId'] || null;
    });

    this.route.params.subscribe(params => {
      this.storyId = params['storyId'];
      const chapterId = params['chapterId'];
      this.loadChapter(chapterId);
      this.loadChapterList(this.storyId);
    });
  }

  ngOnDestroy(): void {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.persistProgress();
    this.cleanupTouchListeners();
  }

  private loadChapter(chapterId: string): void {
    this.isLoading = true;
    this.error = null;
    this.scrollPercent.set(0); // Reset del progresso per evitare leak dal capitolo precedente
    this.lastSavedPercent = -1;
    this.api.getChapter(chapterId).subscribe({
      next: (data) => {
        this.chapter = data;
        this.isLoading = false;
        this.loadHighlights();
        this.cdr.detectChanges();
        // Registra visualizzazione alla prima apertura cap. 1
        const user = this.auth.currentUser();
        if (user && data.order_index === 1) {
          this.api.recordView(data.story_id, user.id).subscribe();
        }
        // Recupera progresso salvato
        if (user) {
          if ((user as any).reading_mode === 'page') {
            this.isScrolled.set(true);
            this.isPastTitle.set(true);
          }
          this.api.getReadingProgress(user.id, data.story_id).subscribe({
            next: (prog) => {
              const progressObj: { [key: string]: number } = {};
              prog.forEach((p: any) => {
                progressObj[p.chapter_id] = p.progress_pct;
              });
              this.chapterProgress.set(progressObj);

              const me = prog.find((p: any) => p.chapter_id === chapterId);
              if (me) {
                this.scrollPercent.set(me.progress_pct);
                this.lastSavedPercent = me.progress_pct;
                if (me.progress_pct >= 100) {
                  this.scrollToPercent(0);
                } else {
                  this.scrollToPercent(me.progress_pct);
                }
              } else {
                this.scrollPercent.set(0);
                this.lastSavedPercent = 0;
              }
              this.cdr.detectChanges();
            }
          });
        }
        if (isPlatformBrowser(this.platformId)) {
          setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 50);
          setTimeout(() => {
            const el = document.querySelector('.reader-text') as HTMLElement;
            if (el) this.updatePageCount(el);
          }, 300);
        }
      },
      error: () => {
        this.error = 'Impossibile caricare il capitolo.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  private loadChapterList(storyId: string): void {
    this.api.getChapters(storyId).subscribe({
      next: (list) => this.chapters.set(list),
    });
  }

  private persistProgress(): void {
    const user = this.auth.currentUser();
    if (!user || !this.chapter) return;
    const currentPct = this.scrollPercent();
    if (currentPct === this.lastSavedPercent) return;

    this.lastSavedPercent = currentPct;

    const currentMap = { ...this.chapterProgress() };
    currentMap[this.chapter.id] = currentPct;
    this.chapterProgress.set(currentMap);

    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);

    this.api.saveReadingProgress(user.id, this.chapter.id, currentPct).subscribe();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.querySelector('.reader-text') as HTMLElement;
    if (el) this.updatePageCount(el);
  }

  @HostListener('window:scroll')
  onScroll(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const el = document.documentElement;
    const scrolled = el.scrollTop;

    // Aggiorna lo stato della topbar
    this.isScrolled.set(scrolled > 20); // La barra diventa pillola quasi subito
    this.isPastTitle.set(scrolled > window.innerHeight * 0.4); // Mostra il titolo quando si supera l'header (circa 40vh)

    const total = el.scrollHeight - el.clientHeight;
    const pct = total > 0 ? Math.round((scrolled / total) * 100) : 0;
    this.updateScrollPercent(pct);
  }

  goToChapter(chapter: any): void {
    this.persistProgress();
    this.sidebarOpen = false;
    this.router.navigate(['/reader', this.storyId, chapter.id]);
  }

  prevChapter(): void {
    if (!this.chapter) return;
    const chs = this.chapters();
    const idx = chs.findIndex(c => c.id === this.chapter.id);
    if (idx > 0) this.goToChapter(chs[idx - 1]);
  }

  nextChapter(): void {
    if (!this.chapter) return;
    const chs = this.chapters();
    const idx = chs.findIndex(c => c.id === this.chapter.id);
    if (idx < chs.length - 1) {
      // Segna il capitolo corrente come 100% letto prima di passare al prossimo
      this.updateScrollPercent(100);
      this.goToChapter(chs[idx + 1]);
    } else {
      // Fine storia → segna come completato e torna ai dettagli
      this.updateScrollPercent(100);
      this.persistProgress();
      this.router.navigate(['/book', this.storyId]);
    }
  }

  get hasPrev(): boolean {
    const chs = this.chapters();
    const idx = chs.findIndex(c => c.id === this.chapter?.id);
    return idx > 0;
  }

  get hasNext(): boolean {
    const chs = this.chapters();
    const idx = chs.findIndex(c => c.id === this.chapter?.id);
    return idx < chs.length - 1;
  }

  get isLastChapter(): boolean {
    const chs = this.chapters();
    const idx = chs.findIndex(c => c.id === this.chapter?.id);
    return idx === chs.length - 1;
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  goBack(): void {
    this.persistProgress();
    this.router.navigate(['/book', this.storyId]);
  }

  /** Testo formattato: divide per paragrafi */
  get paragraphs(): string[] {
    return (this.chapter?.content ?? '').split('\n\n').filter((p: string) => p.trim());
  }

  loadHighlights(): void {
    const user = this.auth.currentUser();
    if (!user || !this.chapter) {
      this.recomputeSegments();
      return;
    }
    this.api.getChapterHighlights(this.chapter.id, user.id).subscribe({
      next: (data) => {
        this.chapterHighlights = data;
        this.recomputeSegments();
        this.cdr.detectChanges();

        if (this.highlightIdToScroll) {
          this.scrollToHighlight(this.highlightIdToScroll);
          this.highlightIdToScroll = null;
        }
      },
      error: (err) => {
        console.warn('Errore nel caricamento delle sottolineature:', err);
        this.recomputeSegments();
      }
    });
  }

  private scrollToHighlight(highlightId: string): void {
    setTimeout(() => {
      const el = document.getElementById('highlight-' + highlightId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        el.classList.add('highlight-pulse');
        setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
      }
    }, 200);
  }

  recomputeSegments(): void {
    const rawParas = this.paragraphs;
    const segmentsList = [];

    for (let pIdx = 0; pIdx < rawParas.length; pIdx++) {
      const text = rawParas[pIdx];
      let pHighlights = [...this.chapterHighlights.filter(h => h.paragraph_index === pIdx)];

      if (this.activeSelection && this.activeSelection.paragraphIndex === pIdx) {
        const start = this.activeSelection.startOffset;
        const end = this.activeSelection.endOffset;
        // Filter out overlapping highlights to preview the merged highlight in real-time
        pHighlights = pHighlights.filter(h => !(start < h.end_offset && end > h.start_offset));

        pHighlights.push({
          id: 'selection-preview',
          paragraph_index: pIdx,
          start_offset: start,
          end_offset: end,
          color: this.selectedColor
        });
      }

      pHighlights.sort((a, b) => a.start_offset - b.start_offset);

      const segments = [];
      let idx = 0;

      for (const h of pHighlights) {
        if (h.start_offset >= idx && h.start_offset <= text.length) {
          if (h.start_offset > idx) {
            segments.push({
              text: text.slice(idx, h.start_offset),
              highlighted: false,
              start: idx,
              end: h.start_offset
            });
          }
          const end = Math.min(h.end_offset, text.length);
          segments.push({
            text: text.slice(h.start_offset, end),
            highlighted: true,
            highlightId: h.id,
            color: h.color,
            start: h.start_offset,
            end: end
          });
          idx = end;
        }
      }

      if (idx < text.length) {
        segments.push({
          text: text.slice(idx),
          highlighted: false,
          start: idx,
          end: text.length
        });
      }

      segmentsList.push(segments);
    }

    this.paragraphsWithSegments = segmentsList;
  }

  getSelectionCharacterOffsetsWithin(element: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(element);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    const end = start + range.toString().length;
    return { start, end };
  }

  getRangeCharacterOffsetsWithin(range: Range, element: HTMLElement) {
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(element);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;
    const end = start + range.toString().length;
    return { start, end };
  }

  hideFloatingBtn() {
    this.floatingBtnStyle = {
      display: 'none',
      top: '0px',
      left: '0px'
    };
    this.activeSelection = null;
  }

  @HostListener('document:selectionchange')
  onSelectionChange() {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.isTouchDevice()) return; // Don't track native selection on touch devices
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      this.activeSelection = null;
      this.cdr.detectChanges();
      return;
    }

    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;
    const pEl = startContainer.parentElement?.closest('.reader-paragraph') as HTMLElement;
    if (!pEl) {
      this.hideFloatingBtn();
      return;
    }

    const pIdxStr = pEl.getAttribute('data-para-index');
    if (pIdxStr === null) {
      this.hideFloatingBtn();
      return;
    }

    const paragraphIndex = parseInt(pIdxStr, 10);
    const selectedText = selection.toString();

    const offsets = this.getSelectionCharacterOffsetsWithin(pEl);
    if (!offsets) {
      this.hideFloatingBtn();
      return;
    }

    this.activeSelection = {
      paragraphIndex,
      startOffset: offsets.start,
      endOffset: offsets.end,
      text: selectedText
    };

    this.cdr.detectChanges();
  }

  @HostListener('document:mouseup', ['$event'])
  onMouseUp(event: any) {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.isTouchDevice()) return;
    const target = event.target as HTMLElement;
    const panel = document.querySelector('.highlight-panel-container');
    if (panel && panel.contains(target)) {
      return;
    }
    // On desktop (mouseup): auto-highlight if mode is active
    if (event.type === 'mouseup' && this.highlightModeActive && this.activeSelection) {
      this.createHighlight();
    }
  }

  /** Returns true on touch devices (mobile/tablet) */
  isTouchDevice(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return 'ontouchstart' in window || window.matchMedia('(pointer: coarse)').matches;
  }

  private setupTouchListeners() {
    if (!this.readerTextElement) return;
    this.cleanupTouchListeners();

    this.readerTextElement.addEventListener('touchstart', this.boundTouchStart, { passive: true });
    this.readerTextElement.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    this.readerTextElement.addEventListener('touchend', this.boundTouchEnd, { passive: true });
    this.readerTextElement.addEventListener('touchcancel', this.boundTouchEnd, { passive: true });
  }

  private cleanupTouchListeners() {
    if (this.readerTextElement) {
      this.readerTextElement.removeEventListener('touchstart', this.boundTouchStart);
      this.readerTextElement.removeEventListener('touchmove', this.boundTouchMove);
      this.readerTextElement.removeEventListener('touchend', this.boundTouchEnd);
      this.readerTextElement.removeEventListener('touchcancel', this.boundTouchEnd);
    }
    document.removeEventListener('touchmove', this.boundHandleTouchMove);
    document.removeEventListener('touchend', this.boundHandleTouchEnd);
    document.removeEventListener('touchcancel', this.boundHandleTouchEnd);
  }

  private handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    const target = event.target as HTMLElement;

    // Ignore if tapping virtual handle pins
    if (target.closest('.virtual-handle')) {
      return;
    }

    const pEl = target.closest('.reader-paragraph') as HTMLElement;
    if (!pEl) return;

    const pIdxStr = pEl.getAttribute('data-para-index');
    if (pIdxStr === null) return;

    const pIdx = parseInt(pIdxStr, 10);
    this.touchStartTime = Date.now();
    this.touchStartPos = { x: touch.clientX, y: touch.clientY };
    this.touchParagraphIndex = pIdx;
    this.touchParagraphEl = pEl;
    this.isDrawingHighlight = false;
    this.isTouchScrolling = false;

    // Start a long press timer (500ms) to trigger word selection on touch-hold
    if (this.longPressTimeout) clearTimeout(this.longPressTimeout);
    this.longPressTimeout = setTimeout(() => {
      this.selectWordAtPoint(touch.clientX, touch.clientY, pEl, pIdx);
    }, 500);

    // Double tap detection
    const now = Date.now();
    if (now - this.lastTouchTime < 300) {
      if (this.longPressTimeout) clearTimeout(this.longPressTimeout);
      this.selectWordAtPoint(touch.clientX, touch.clientY, pEl, pIdx);
    }
    this.lastTouchTime = now;

    // Resolve starting offset if highlighter brush is active
    if (this.highlightModeActive) {
      const startOffset = this.getCaretOffsetFromPoint(touch.clientX, touch.clientY, pEl);
      if (startOffset !== null) {
        this.touchStartOffset = this.getWordBoundaryOffset(startOffset, pEl, 'start');
        this.minTouchOffset = this.touchStartOffset;
        this.maxTouchOffset = this.touchStartOffset;
      }
    }
  }

  private handleTouchMove(event: TouchEvent) {
    if (!this.touchStartPos || !this.touchParagraphEl) return;
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - this.touchStartPos.x;
    const dy = touch.clientY - this.touchStartPos.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Cancel long press if finger moved significantly (more than 8px)
    if (absDx > 8 || absDy > 8) {
      if (this.longPressTimeout) {
        clearTimeout(this.longPressTimeout);
        this.longPressTimeout = null;
      }
    }

    if (this.highlightModeActive) {
      // Prevent scrolling unconditionally on mobile when highlighter is active
      if (event.cancelable) {
        event.preventDefault();
      }

      if (!this.isDrawingHighlight && !this.isTouchScrolling) {
        this.isDrawingHighlight = true;
        this.activeSelection = null; // Clear active selection to start fresh swipe highlight
      }

      if (this.isDrawingHighlight && this.touchStartOffset !== null) {
        const currentOffset = this.getCaretOffsetFromPoint(touch.clientX, touch.clientY, this.touchParagraphEl);
        if (currentOffset !== null && this.touchParagraphIndex !== null) {
          if (this.minTouchOffset === null || this.minTouchOffset === undefined) {
            this.minTouchOffset = this.touchStartOffset;
          }
          if (this.maxTouchOffset === null || this.maxTouchOffset === undefined) {
            this.maxTouchOffset = this.touchStartOffset;
          }
          this.minTouchOffset = Math.min(this.minTouchOffset, currentOffset);
          this.maxTouchOffset = Math.max(this.maxTouchOffset, currentOffset);

          let start = this.minTouchOffset;
          let end = this.maxTouchOffset;

          // Snap selection boundaries to full word boundaries
          start = this.getWordBoundaryOffset(start, this.touchParagraphEl, 'start');
          end = this.getWordBoundaryOffset(end, this.touchParagraphEl, 'end');

          const paragraphText = this.paragraphs[this.touchParagraphIndex] || '';
          const selectedText = paragraphText.slice(start, end);

          this.activeSelection = {
            paragraphIndex: this.touchParagraphIndex,
            startOffset: start,
            endOffset: end,
            text: selectedText
          };

          this.recomputeSegments();
          this.cdr.detectChanges();
        }
      }
    }
  }

  private handleTouchEnd(event: TouchEvent) {
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }

    if (this.highlightModeActive && this.isDrawingHighlight && this.activeSelection && this.activeSelection.text && this.activeSelection.text.trim().length > 0) {
      // Keep selection active so they can adjust using virtual handles
      this.justSelectedWord = true;
    }

    this.touchStartPos = null;
    this.touchParagraphIndex = null;
    this.touchStartOffset = null;
    this.touchParagraphEl = null;
    this.minTouchOffset = null;
    this.maxTouchOffset = null;
    this.isDrawingHighlight = false;
    this.isTouchScrolling = false;
  }

  private getCaretRangeFromPoint(x: number, y: number): Range | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    // Search around the touch point with multiple vertical offsets to account for touch offsets and teardrop handles
    const yCoords = [y - 20, y, y - 10, y - 30, y + 10];
    for (const targetY of yCoords) {
      let range: Range | null = null;
      if (typeof (document as any).caretRangeFromPoint === 'function') {
        range = (document as any).caretRangeFromPoint(x, targetY);
      } else if (typeof (document as any).caretPositionFromPoint === 'function') {
        const pos = (document as any).caretPositionFromPoint(x, targetY);
        if (pos && pos.offsetNode) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.setEnd(pos.offsetNode, pos.offset);
        }
      }

      if (range) {
        return range;
      }
    }
    return null;
  }

  private selectWordAtPoint(x: number, y: number, pEl: HTMLElement, paragraphIndex: number) {
    const range = this.getCaretRangeFromPoint(x, y);
    if (!range || !pEl.contains(range.startContainer) || range.startContainer.nodeType !== Node.TEXT_NODE) return;

    const textNode = range.startContainer as Text;
    const fullText = textNode.textContent || '';
    const WORD_BREAK = /[\s\n\r,;:.!?'"«»\-\u2013\u2014()\[\]]/;

    let startOff = range.startOffset;
    let endOff = range.startOffset;

    // Expand to word boundaries
    while (startOff > 0 && !WORD_BREAK.test(fullText[startOff - 1])) startOff--;
    while (endOff < fullText.length && !WORD_BREAK.test(fullText[endOff])) endOff++;

    if (startOff >= endOff) return;

    range.setStart(textNode, startOff);
    range.setEnd(textNode, endOff);

    const wordOffsets = this.getRangeCharacterOffsetsWithin(range, pEl);
    if (!wordOffsets) return;

    const selectedText = fullText.slice(startOff, endOff);

    this.activeSelection = {
      paragraphIndex,
      startOffset: wordOffsets.start,
      endOffset: wordOffsets.end,
      text: selectedText
    };

    // Store context for handles adjustments
    this.touchParagraphIndex = paragraphIndex;
    this.touchParagraphEl = pEl;
    this.justSelectedWord = true;
    this.highlightModeActive = true; // Auto-activate highlighter mode when selecting a word!

    // Clear native browser selection
    window.getSelection()?.removeAllRanges();

    this.recomputeSegments();
    this.cdr.detectChanges();
  }

  handleVirtualTouchStart(event: TouchEvent, type: 'start' | 'end') {
    event.preventDefault();
    event.stopPropagation();

    const target = event.target as HTMLElement;
    const pEl = target.closest('.reader-paragraph') as HTMLElement;
    if (!pEl) return;

    const pIdxStr = pEl.getAttribute('data-para-index');
    if (pIdxStr === null) return;

    this.touchParagraphEl = pEl;
    this.touchParagraphIndex = parseInt(pIdxStr, 10);
    this.isDraggingHandle = true;
    this.draggedHandleType = type;

    // Attach programmatic touch events on document for absolute drag tracking
    document.addEventListener('touchmove', this.boundHandleTouchMove, { passive: false });
    document.addEventListener('touchend', this.boundHandleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', this.boundHandleTouchEnd, { passive: true });
  }

  private handleHandleTouchMove(event: TouchEvent) {
    if (!this.isDraggingHandle || !this.activeSelection || !this.touchParagraphEl || !this.draggedHandleType) return;
    if (event.touches.length < 1) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    const touch = event.touches[0];
    const currentOffset = this.getCaretOffsetFromPoint(touch.clientX, touch.clientY, this.touchParagraphEl);
    if (currentOffset === null) return;

    let start = this.activeSelection.startOffset;
    let end = this.activeSelection.endOffset;

    if (this.draggedHandleType === 'start') {
      start = Math.min(currentOffset, end);
    } else {
      end = Math.max(currentOffset, start);
    }

    const paragraphText = this.paragraphs[this.activeSelection.paragraphIndex] || '';
    const selectedText = paragraphText.slice(start, end);

    this.activeSelection = {
      ...this.activeSelection,
      startOffset: start,
      endOffset: end,
      text: selectedText
    };

    this.recomputeSegments();
    this.cdr.detectChanges();
  }

  private handleHandleTouchEnd(event: TouchEvent) {
    this.isDraggingHandle = false;
    this.draggedHandleType = null;

    document.removeEventListener('touchmove', this.boundHandleTouchMove);
    document.removeEventListener('touchend', this.boundHandleTouchEnd);
    document.removeEventListener('touchcancel', this.boundHandleTouchEnd);
  }

  private getCaretOffsetFromPoint(x: number, y: number, pEl: HTMLElement): number | null {
    const range = this.getCaretRangeFromPoint(x, y);
    if (!range) return null;

    if (pEl.contains(range.startContainer)) {
      const offsets = this.getRangeCharacterOffsetsWithin(range, pEl);
      return offsets ? offsets.start : null;
    } else {
      // The touch coordinates are outside the paragraph boundary (e.g. in margins).
      // We cap the offset dynamically based on touch relative position.
      const rect = pEl.getBoundingClientRect();
      if (y < rect.top) {
        return 0; // Dragged above the paragraph
      } else if (y > rect.bottom) {
        return pEl.textContent?.length || 0; // Dragged below the paragraph
      } else if (x < rect.left) {
        return 0; // Dragged left of the paragraph
      } else if (x > rect.right) {
        return pEl.textContent?.length || 0; // Dragged right of the paragraph
      }
    }
    return null;
  }

  private getWordBoundaryOffset(offset: number, pEl: HTMLElement, boundary: 'start' | 'end'): number {
    const text = pEl.textContent || '';
    const WORD_BREAK = /[\s\n\r,;:.!?'"«»\-\u2013\u2014()\[\]]/;
    let off = Math.min(Math.max(0, offset), text.length);

    if (boundary === 'start') {
      while (off > 0 && !WORD_BREAK.test(text[off - 1])) {
        off--;
      }
    } else {
      while (off < text.length && !WORD_BREAK.test(text[off])) {
        off++;
      }
    }
    return off;
  }

  /**
   * On mobile when highlight mode is active, tapping the text triggers a range selection
   * preview: the first tap on a word starts selection, the second tap on another word in
   * the same paragraph expands selection to cover everything in between.
   */
  onReaderTextClick(event: MouseEvent) {
    if (!isPlatformBrowser(this.platformId)) return;
    // On mobile, let the native text selection gestures (double-tap, long-press) work natively
    if (this.isTouchDevice()) return;
    if (!this.highlightModeActive) return;

    // Don't interfere with taps on existing highlights (except selection-preview)
    const target = event.target as HTMLElement;
    const highlightedEl = target.closest('.text-highlighted');
    if (highlightedEl && !highlightedEl.classList.contains('selection-preview')) return;
    if (target.closest('.highlight-actions-popover')) return;

    // Resolve caret position from tap coordinates
    let range: Range | null = null;
    const x = event.clientX;
    const y = event.clientY;

    if (typeof (document as any).caretRangeFromPoint === 'function') {
      // Chrome, Safari, Edge
      range = (document as any).caretRangeFromPoint(x, y);
    } else if (typeof (document as any).caretPositionFromPoint === 'function') {
      // Firefox
      const pos = (document as any).caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }

    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) return;

    // Make sure the tap is inside the reader content
    const readerText = document.querySelector('.reader-text');
    if (!readerText || !readerText.contains(range.startContainer)) return;

    // Expand the caret range to full word boundaries
    const textNode = range.startContainer as Text;
    const fullText = textNode.textContent || '';
    const WORD_BREAK = /[\s\n\r,;:.!?'"«»\-\u2013\u2014()\[\]]/;

    let startOff = range.startOffset;
    let endOff = range.startOffset;

    while (startOff > 0 && !WORD_BREAK.test(fullText[startOff - 1])) startOff--;
    while (endOff < fullText.length && !WORD_BREAK.test(fullText[endOff])) endOff++;

    if (startOff >= endOff) return; // Tapped on whitespace/punctuation only

    range.setStart(textNode, startOff);
    range.setEnd(textNode, endOff);

    // Apply selection
    const pEl = range.startContainer.parentElement?.closest('.reader-paragraph') as HTMLElement;
    if (!pEl) return;
    const pIdxStr = pEl.getAttribute('data-para-index');
    if (pIdxStr === null) return;
    const paragraphIndex = parseInt(pIdxStr, 10);

    const wordOffsets = this.getRangeCharacterOffsetsWithin(range, pEl);
    if (!wordOffsets) return;

    // Word text
    const selectedText = fullText.slice(startOff, endOff);

    // If we have an active selection in the same paragraph, expand it!
    if (this.activeSelection && this.activeSelection.paragraphIndex === paragraphIndex) {
      // Find start and end offset spanning both selections
      const start = Math.min(this.activeSelection.startOffset, wordOffsets.start);
      const end = Math.max(this.activeSelection.endOffset, wordOffsets.end);
      const paragraphText = this.paragraphs[paragraphIndex] || '';

      this.activeSelection = {
        paragraphIndex,
        startOffset: start,
        endOffset: end,
        text: paragraphText.slice(start, end)
      };
    } else {
      // Otherwise, start a new selection
      this.activeSelection = {
        paragraphIndex,
        startOffset: wordOffsets.start,
        endOffset: wordOffsets.end,
        text: selectedText
      };
    }

    // Clear native selection so browser handles don't clash with our preview
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    // Recompute segments to show the selection preview immediately
    this.recomputeSegments();
    this.cdr.detectChanges();
  }

  toggleHighlightMode() {
    if (this.activeSelection) {
      this.createHighlight();
    } else {
      this.highlightModeActive = !this.highlightModeActive;
    }
    this.cdr.detectChanges();
  }

  selectColor(color: string) {
    this.selectedColor = color;
    this.highlightModeActive = true;

    // Se c'è una selezione attiva, applica subito la sottolineatura!
    if (this.activeSelection) {
      this.createHighlight();
    }
    this.cdr.detectChanges();
  }

  getHighlightClass(color: string): string {
    if (!color) return 'hl-yellow';
    if (color.includes('46, 204, 113') || color === 'green') return 'hl-green';
    if (color.includes('231, 76, 60') || color === 'red') return 'hl-red';
    if (color.includes('52, 152, 219') || color === 'blue') return 'hl-blue';
    if (color.includes('155, 89, 182') || color === 'purple') return 'hl-purple';
    return 'hl-yellow';
  }

  createHighlight() {
    const user = this.auth.currentUser();
    if (!user || !this.chapter || !this.activeSelection) return;

    // Rimuoviamo subito la selezione nativa del browser per evitare che rimanga blu
    if (isPlatformBrowser(this.platformId)) {
      window.getSelection()?.removeAllRanges();
    }

    const paragraphIndex = this.activeSelection.paragraphIndex;
    const start = this.activeSelection.startOffset;
    const end = this.activeSelection.endOffset;
    const text = this.activeSelection.text;

    // Troviamo eventuali sottolineature sovrapposte nello stesso paragrafo
    const overlapping = this.chapterHighlights.filter(h =>
      h.paragraph_index === paragraphIndex &&
      start < h.end_offset &&
      end > h.start_offset
    );

    const activeSelBackup = { ...this.activeSelection };
    this.hideFloatingBtn();

    if (overlapping.length > 0) {
      // Se la nuova selezione è interamente contenuta in una sottolineatura esistente, cambiamo solo il colore o non facciamo nulla
      const fullyContained = overlapping.find(h => start >= h.start_offset && end <= h.end_offset);
      if (fullyContained) {
        if (fullyContained.color !== this.selectedColor) {
          const backupHighlights = JSON.parse(JSON.stringify(this.chapterHighlights));
          fullyContained.color = this.selectedColor;
          this.recomputeSegments();
          this.cdr.detectChanges();

          this.api.updateHighlight(fullyContained.id, {
            color: this.selectedColor,
            startOffset: fullyContained.start_offset,
            endOffset: fullyContained.end_offset,
            text: fullyContained.text
          }).subscribe({
            next: (updated) => {
              this.chapterHighlights = this.chapterHighlights.map(h => h.id === fullyContained.id ? updated : h);
              this.recomputeSegments();
              this.cdr.detectChanges();
            },
            error: (err) => {
              console.error('Errore aggiornamento colore sottolineatura contenuta:', err);
              this.chapterHighlights = backupHighlights;
              this.recomputeSegments();
              this.cdr.detectChanges();
            }
          });
        }
        return;
      }

      // Manteniamo un backup per poter ripristinare in caso di errore
      const backupHighlights = JSON.parse(JSON.stringify(this.chapterHighlights));

      const paragraphText = this.paragraphs[paragraphIndex] || '';
      const newStart = Math.min(start, ...overlapping.map(o => o.start_offset));
      const newEnd = Math.max(end, ...overlapping.map(o => o.end_offset));
      const mergedText = paragraphText ? paragraphText.slice(newStart, newEnd) : text;

      const targetHighlight = overlapping[0];
      const otherOverlapping = overlapping.slice(1);

      // Aggiorniamo ottimisticamente il target highlight
      targetHighlight.start_offset = newStart;
      targetHighlight.end_offset = newEnd;
      targetHighlight.text = mergedText;
      targetHighlight.color = this.selectedColor;

      // Rimuoviamo gli altri sovrapposti dall'elenco locale
      const otherIds = otherOverlapping.map(o => o.id);
      this.chapterHighlights = this.chapterHighlights.filter(h => !otherIds.includes(h.id));

      this.recomputeSegments();
      this.cdr.detectChanges();

      // 1. Chiamata API per aggiornare il primo
      this.api.updateHighlight(targetHighlight.id, {
        color: this.selectedColor,
        startOffset: newStart,
        endOffset: newEnd,
        text: mergedText
      }).subscribe({
        next: (updated) => {
          this.chapterHighlights = this.chapterHighlights.map(h => h.id === targetHighlight.id ? updated : h);
          this.recomputeSegments();
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Errore aggiornamento sottolineatura sovrapposta:', err);
          this.chapterHighlights = backupHighlights;
          this.recomputeSegments();
          this.cdr.detectChanges();
        }
      });

      // 2. Chiamate API per eliminare gli altri duplicati/sovrapposti
      for (const otherId of otherIds) {
        this.api.deleteHighlight(otherId).subscribe({
          error: (err) => console.error('Errore eliminazione highlight sovrapposto duplicato:', err)
        });
      }
    } else {
      // Nessuna sovrapposizione: crea una nuova sottolineatura
      const tempId = 'temp-' + Date.now();
      const tempHighlight = {
        id: tempId,
        user_id: user.id,
        story_id: this.chapter.story_id,
        chapter_id: this.chapter.id,
        paragraph_index: paragraphIndex,
        start_offset: start,
        end_offset: end,
        text: text,
        color: this.selectedColor
      };

      this.chapterHighlights.push(tempHighlight);
      this.recomputeSegments();
      this.cdr.detectChanges();

      const payload = {
        userId: user.id,
        storyId: this.chapter.story_id,
        chapterId: this.chapter.id,
        paragraphIndex: activeSelBackup.paragraphIndex,
        startOffset: activeSelBackup.startOffset,
        endOffset: activeSelBackup.endOffset,
        text: activeSelBackup.text,
        color: this.selectedColor
      };

      this.api.addHighlight(payload).subscribe({
        next: (newHighlight) => {
          this.chapterHighlights = this.chapterHighlights.filter(h => h.id !== tempId);
          this.chapterHighlights.push(newHighlight);
          this.recomputeSegments();
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.error('Errore creazione sottolineatura:', err);
          this.chapterHighlights = this.chapterHighlights.filter(h => h.id !== tempId);
          this.recomputeSegments();
          this.cdr.detectChanges();
        }
      });
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!isPlatformBrowser(this.platformId)) return;
    const target = event.target as HTMLElement;
    const readerArticle = document.querySelector('.reader-article');
    const panel = document.querySelector('.highlight-panel-container');

    // Controlliamo se il click è dentro l'articolo o nel pannello dei colori/highlight
    const isInsideText = readerArticle && readerArticle.contains(target);
    const isInsidePanel = panel && panel.contains(target);

    // Controlliamo se è un click su un dialog di conferma o un overlay (per l'eliminazione)
    const isInsideDialog = target.closest('.dialog-overlay') || target.closest('.dialog-container') || target.closest('.modal-container');

    // Su mobile consideriamo come "fuori dal testo" qualsiasi click che non sia su un paragrafo
    const isInsideParagraph = target.closest('.reader-paragraph');

    // Per mobile, perdere il focus significa cliccare fuori dai paragrafi
    const isLosingFocus = this.isTouchDevice()
      ? (!isInsideParagraph && !isInsidePanel && !isInsideDialog)
      : (!isInsideText && !isInsidePanel && !isInsideDialog);

    if (isLosingFocus) {
      window.getSelection()?.removeAllRanges();
      if (this.activeSelection && this.activeSelection.text && this.activeSelection.text.trim().length > 0) {
        this.createHighlight();
      } else {
        this.hideFloatingBtn();
        this.recomputeSegments();
      }
      this.highlightModeActive = false;
      this.cdr.detectChanges();
    }

    if (!target.closest('.text-highlighted') && !target.closest('.highlight-actions-popover') && !target.closest('.mobile-share-sheet')) {
      this.activeHighlightId = null;
      this.shareMenuOpenForHighlightId = null;
      this.activeShareHighlight = null;
      this.cdr.detectChanges();
    }
  }

  onHighlightMouseEnter(highlightId: string) {
    if (this.hoverTimeout) clearTimeout(this.hoverTimeout);
    this.hoveredHighlightId = highlightId;
    this.cdr.detectChanges();
  }

  onHighlightMouseLeave(highlightId: string) {
    this.hoverTimeout = setTimeout(() => {
      this.hoveredHighlightId = null;
      this.cdr.detectChanges();
    }, 500); // 500ms delay to keep the popover open while moving mouse
  }

  onHighlightClick(seg: any, event: Event) {
    event.stopPropagation();
    // Toggle active lock on click (works on both desktop and mobile)
    if (this.activeHighlightId === seg.highlightId) {
      this.activeHighlightId = null;
      this.shareMenuOpenForHighlightId = null;
    } else {
      this.activeHighlightId = seg.highlightId;
    }
    this.cdr.detectChanges();
  }

  async deleteHighlightFromPopover(highlightId: string, event: Event) {
    event.stopPropagation();
    const hl = this.chapterHighlights.find(h => h.id === highlightId);
    if (hl) {
      const confirmed = await this.dialogService.confirm(
        'Elimina Sottolineatura',
        'Sei sicuro di voler eliminare questa frase dalle tue sottolineature?'
      );
      if (confirmed) {
        this.selectedHighlightToDelete = hl;
        this.confirmDeleteHighlight();
      }
    }
  }

  confirmDeleteHighlight() {
    if (!this.selectedHighlightToDelete) return;
    this.api.deleteHighlight(this.selectedHighlightToDelete.id).subscribe({
      next: () => {
        this.chapterHighlights = this.chapterHighlights.filter(h => h.id !== this.selectedHighlightToDelete.id);
        this.recomputeSegments();
        this.selectedHighlightToDelete = null;
        this.activeHighlightId = null;
        this.hoveredHighlightId = null;
        this.shareMenuOpenForHighlightId = null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Errore eliminazione sottolineatura:', err);
        this.selectedHighlightToDelete = null;
      }
    });
  }

  cancelDeleteHighlight() {
    this.selectedHighlightToDelete = null;
  }

  toggleHighlightShareMenu(seg: any, event: Event) {
    event.stopPropagation();
    if (this.isTouchDevice()) {
      this.activeShareHighlight = seg;
    } else {
      if (this.shareMenuOpenForHighlightId === seg.highlightId) {
        this.shareMenuOpenForHighlightId = null;
      } else {
        this.shareMenuOpenForHighlightId = seg.highlightId;
      }
    }
    this.cdr.detectChanges();
  }

  closeMobileShareMenu() {
    this.activeShareHighlight = null;
    this.cdr.detectChanges();
  }

  copyHighlightLink(seg: any, event: Event) {
    event.stopPropagation();
    if (!seg.highlightId || !this.chapter) return;
    const url = window.location.origin + '/reader/' + this.chapter.story_id + '/' + this.chapter.id + '?highlightId=' + seg.highlightId;
    navigator.clipboard.writeText(url).then(
      () => {
        this.dialogService.alert('Copiato', 'Link della citazione copiato negli appunti!');
        this.shareMenuOpenForHighlightId = null;
        this.activeShareHighlight = null;
        this.cdr.detectChanges();
      },
      () => {
        this.dialogService.alert('Errore', 'Impossibile copiare il link.');
      }
    );
  }

  shareHighlightToCommunity(seg: any, event: Event) {
    event.stopPropagation();
    if (!this.chapter) return;
    this.shareMenuOpenForHighlightId = null;
    this.activeShareHighlight = null;
    this.router.navigate(['/community'], {
      queryParams: {
        shareStoryId: this.chapter.story_id,
        shareHighlightText: seg.text
      }
    });
  }

  isNativeShareSupported(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return !!navigator.share;
  }

  shareHighlightOnSocial(seg: any, platform: string, event: Event) {
    event.stopPropagation();
    if (!this.chapter) return;
    const url = encodeURIComponent(window.location.origin + '/reader/' + this.chapter.story_id + '/' + this.chapter.id + '?highlightId=' + seg.highlightId);
    const title = encodeURIComponent(`"${seg.text}" - Citazione da ${this.chapter.story_title}`);
    let shareUrl = '';

    switch (platform) {
      case 'whatsapp':
        shareUrl = `https://api.whatsapp.com/send?text=${title}%20${url}`;
        break;
      case 'telegram':
        shareUrl = `https://t.me/share/url?url=${url}&text=${title}`;
        break;
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
        break;
      case 'x':
        shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${title}`;
        break;
      case 'native':
        if (navigator.share) {
          navigator.share({
            title: `Citazione da ${this.chapter.story_title}`,
            text: `"${seg.text}"`,
            url: decodeURIComponent(url)
          }).then(() => {
            this.shareMenuOpenForHighlightId = null;
            this.activeShareHighlight = null;
            this.cdr.detectChanges();
          }).catch((err) => {
            console.log('Condivisione annullata o fallita:', err);
          });
        }
        return;
    }

    if (shareUrl) {
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
      this.shareMenuOpenForHighlightId = null;
      this.activeShareHighlight = null;
      this.cdr.detectChanges();
    }
  }
}
