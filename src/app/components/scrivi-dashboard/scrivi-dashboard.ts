import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../services/api';
import { AuthService } from '../../services/auth.service';
import { Navbar } from '../navbar/navbar';
import { DialogService } from '../../services/dialog.service';

@Component({
  selector: 'app-scrivi-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, Navbar, FormsModule],
  templateUrl: './scrivi-dashboard.html',
  styleUrl: './scrivi-dashboard.scss',
})
export class ScriviDashboard implements OnInit {
  private api = inject(Api);
  private auth = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private dialogService = inject(DialogService);

  stories: any[] = [];
  loading = true;

  // Series properties
  activeTab: 'stories' | 'series' = 'stories';
  seriesList: any[] = [];
  showSeriesModal = false;
  isEditingSeries = false;
  editingSeriesId: string | null = null;
  seriesForm = {
    name: '',
    description: '',
    storyIds: [] as string[]
  };

  ngOnInit() {
    this.loadStories();
    this.loadSeries();
  }

  setActiveTab(tab: 'stories' | 'series') {
    this.activeTab = tab;
    this.cdr.detectChanges();
  }

  loadStories() {
    const user = this.auth.currentUser();
    if (!user) {
      if (typeof window !== 'undefined') {
        this.router.navigate(['/login']);
      }
      return;
    }
    this.loading = true;
    this.api.getAuthorDashboardStories(user.id).subscribe({
      next: (data) => {
        this.stories = data;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error fetching dashboard stories', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadSeries() {
    const user = this.auth.currentUser();
    if (!user) return;
    this.api.getSeries(user.id).subscribe({
      next: (data) => {
        this.seriesList = data;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Error fetching series', err)
    });
  }

  createNewStory() {
    const user = this.auth.currentUser();
    if (!user) return;
    
    // Create draft story
    this.api.createStory({ author_id: user.id, title: 'Nuova Storia' }).subscribe({
      next: (story) => {
        // Navigate to editor
        this.router.navigate(['/scrivi', story.id]);
      },
      error: async (err) => {
        console.error('Error creating story', err);
        await this.dialogService.alert("Errore", "Errore durante la creazione della storia! Assicurati di aver riavviato il server Node dal terminale.\n\nDettaglio: " + err.message);
      }
    });
  }

  async deleteStory(storyId: string, event: Event) {
    event.stopPropagation();
    const confirmed = await this.dialogService.confirm("Elimina Storia", "Sei sicuro di voler eliminare questa storia? L'azione è irreversibile.");
    if (confirmed) {
      this.api.deleteStory(storyId).subscribe({
        next: () => {
          this.stories = this.stories.filter(s => s.id !== storyId);
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error deleting story', err)
      });
    }
  }

  publishStory(story: any, event: Event) {
    event.stopPropagation();
    const newStatus = story.status === 'published' ? 'draft' : 'published';
    this.api.updateStory(story.id, { status: newStatus }).subscribe({
      next: (updated) => {
        story.status = updated.status;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Error publishing story', err)
    });
  }

  goToEditor(storyId: string) {
    this.router.navigate(['/scrivi', storyId]);
  }

  openCreateSeriesModal() {
    this.isEditingSeries = false;
    this.editingSeriesId = null;
    this.seriesForm = {
      name: '',
      description: '',
      storyIds: []
    };
    this.showSeriesModal = true;
    this.cdr.detectChanges();
  }

  openEditSeriesModal(series: any, event: Event) {
    event.stopPropagation();
    this.isEditingSeries = true;
    this.editingSeriesId = series.id;
    this.seriesForm = {
      name: series.name,
      description: series.description || '',
      storyIds: series.stories ? series.stories.map((s: any) => s.id) : []
    };
    this.showSeriesModal = true;
    this.cdr.detectChanges();
  }

  closeSeriesModal() {
    this.showSeriesModal = false;
    this.cdr.detectChanges();
  }

  toggleStorySelection(storyId: string) {
    const story = this.stories.find(s => s.id === storyId);
    if (story && story.status !== 'published') return;

    const idx = this.seriesForm.storyIds.indexOf(storyId);
    if (idx > -1) {
      this.seriesForm.storyIds.splice(idx, 1);
    } else {
      this.seriesForm.storyIds.push(storyId);
    }
    this.cdr.detectChanges();
  }

  isStorySelected(storyId: string): boolean {
    return this.seriesForm.storyIds.includes(storyId);
  }

  getSelectedStoriesInOrder(): any[] {
    return this.seriesForm.storyIds
      .map(id => this.stories.find(story => story.id === id))
      .filter(Boolean);
  }

  moveStoryUp(index: number) {
    if (index === 0) return;
    const temp = this.seriesForm.storyIds[index];
    this.seriesForm.storyIds[index] = this.seriesForm.storyIds[index - 1];
    this.seriesForm.storyIds[index - 1] = temp;
    this.cdr.detectChanges();
  }

  moveStoryDown(index: number) {
    if (index === this.seriesForm.storyIds.length - 1) return;
    const temp = this.seriesForm.storyIds[index];
    this.seriesForm.storyIds[index] = this.seriesForm.storyIds[index + 1];
    this.seriesForm.storyIds[index + 1] = temp;
    this.cdr.detectChanges();
  }

  saveSeries() {
    const user = this.auth.currentUser();
    if (!user || !this.seriesForm.name.trim()) return;

    const data = {
      name: this.seriesForm.name.trim(),
      description: this.seriesForm.description.trim(),
      storyIds: this.seriesForm.storyIds
    };

    if (this.isEditingSeries && this.editingSeriesId) {
      this.api.updateSeries(this.editingSeriesId, data).subscribe({
        next: () => {
          this.loadSeries();
          this.closeSeriesModal();
        },
        error: (err) => console.error('Error updating series', err)
      });
    } else {
      this.api.createSeries(user.id, data).subscribe({
        next: () => {
          this.loadSeries();
          this.closeSeriesModal();
        },
        error: (err) => console.error('Error creating series', err)
      });
    }
  }

  async deleteSeries(seriesId: string, event: Event) {
    event.stopPropagation();
    const confirmed = await this.dialogService.confirm("Elimina Serie", "Sei sicuro di voler eliminare questa serie? I libri all'interno rimarranno intatti.");
    if (confirmed) {
      this.api.deleteSeries(seriesId).subscribe({
        next: () => {
          this.seriesList = this.seriesList.filter(s => s.id !== seriesId);
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error deleting series', err)
      });
    }
  }

  asAny(val: any): any {
    return val;
  }

  sliceStories(stories: any[] | null | undefined, start: number, end: number): any[] {
    if (!stories) return [];
    return stories.slice(start, end);
  }

  sliceTitle(title: any): string {
    if (!title || typeof title !== 'string') return '';
    return title.slice(0, 2);
  }
}
