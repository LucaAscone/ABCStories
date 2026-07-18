import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Api } from '../../services/api';
import { AuthService } from '../../services/auth.service';
import { InteractionsService } from '../../services/interactions.service';
import { Navbar } from '../navbar/navbar';
import { Footer } from '../footer/footer';
import { LoadingService } from '../../services/loading.service';
import { PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-author-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, Navbar],
  templateUrl: './author-detail.html',
  styleUrl: './author-detail.scss',
})
export class AuthorDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(Api);
  private auth = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private loadingService = inject(LoadingService);
  private platformId = inject(PLATFORM_ID);
  public interactions = inject(InteractionsService);

  authorId: string | null = null;
  author: any = null;
  stories: any[] = [];
  seriesList: any[] = [];

  isFollowing = false;
  isCurrentUser = false;
  notificationsEnabled = true;

  followersList: any[] = [];
  followingList: any[] = [];
  followersCount: number = 0;
  followingCount: number = 0;
  displayedFollowersCount: number = 10;
  displayedFollowingCount: number = 10;

  displayedBooksCount: number = 10;

  tabs = ['Tutte', 'Più popolari', 'Recenti'];
  activeTab = 'Tutte';

  recommendedBooks: any[] = [];

  activeSubView: 'opere' | 'follower' | 'seguiti' | 'serie' = 'opere';

  get initials(): string {
    return this.author?.username?.slice(0, 2).toUpperCase() || 'AU';
  }

  get filteredStories() {
    if (!this.stories) return [];

    const copy = [...this.stories];
    if (this.activeTab === 'Più popolari') {
      copy.sort((a, b) => (b.readers_count || 0) - (a.readers_count || 0));
    } else if (this.activeTab === 'Recenti') {
      copy.sort((a, b) => {
        const idA = a.id ? parseInt(a.id, 10) : 0;
        const idB = b.id ? parseInt(b.id, 10) : 0;
        return idB - idA;
      });
    }
    return copy;
  }

  get displayedStories() {
    return this.filteredStories.slice(0, this.displayedBooksCount);
  }

  get displayedFollowers() {
    return this.followersList.slice(0, this.displayedFollowersCount);
  }

  get displayedFollowing() {
    return this.followingList.slice(0, this.displayedFollowingCount);
  }

  setTab(tab: string) {
    this.activeTab = tab;
    this.displayedBooksCount = 10;
  }

  showMoreBooks() {
    this.displayedBooksCount += 10;
  }

  showMoreFollowers() {
    this.displayedFollowersCount += 10;
  }

  showMoreFollowing() {
    this.displayedFollowingCount += 10;
  }

  ngOnInit() {
    this.checkAndLoadAuthor();

    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.checkAndLoadAuthor();
    });

    this.interactions.loadUserInteractions().subscribe();
  }

  checkAndLoadAuthor() {
    if (isPlatformBrowser(this.platformId)) {
      const state = this.router.getCurrentNavigation()?.extras?.state || window.history.state;
      const stateId = state?.authorId;

      if (stateId) {
        if (stateId !== this.authorId) {
          this.authorId = stateId;
          this.loadAuthorData();
        }
      } else {
        const currentUser = this.auth.currentUser();
        if (currentUser) {
          if (currentUser.id !== this.authorId) {
            this.authorId = currentUser.id;
            this.loadAuthorData();
          }
        }
      }
    }
  }

  loadAuthorData() {
    const currentUser = this.auth.currentUser();

    if (this.authorId) {
      this.isCurrentUser = (currentUser && currentUser.id === this.authorId) ? true : false;
      this.isFollowing = false;
      this.activeTab = 'Tutte';
      this.displayedBooksCount = 10;
      this.displayedFollowersCount = 10;

      this.api.getUserProfile(this.authorId).subscribe({
        next: (data) => {
          this.author = data;
          if (this.author?.profilePictureUrl) {
            this.preloadImage(this.author.profilePictureUrl);
          }
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching author', err)
      });

      this.api.getAuthorStories(this.authorId).subscribe({
        next: (data) => {
          this.stories = data;
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching stories', err)
      });

      this.api.getAuthorSeries(this.authorId).subscribe({
        next: (data) => {
          this.seriesList = data;
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching author series', err)
      });

      this.api.getFollowsCount(this.authorId).subscribe({
        next: (data) => {
          this.followersCount = data.followersCount;
          this.followingCount = data.followingCount;
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching follow counts', err)
      });

      this.api.getAuthorFollowers(this.authorId).subscribe({
        next: (data) => {
          this.followersList = data;
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching followers', err)
      });

      this.api.getFollowedAuthors(this.authorId).subscribe({
        next: (data) => {
          this.followingList = data;
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching following', err)
      });

      this.api.getAuthorRecommended(this.authorId).subscribe({
        next: (data) => {
          this.recommendedBooks = data.map((s: any) => ({
            id: s.id,
            title: s.title,
            author: s.author_name || s.author_id,
            desc: s.description,
            img: s.image_url || 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=320&q=80',
            genre: s.genre,
            tag: s.genre,
            rating: s.rating ? parseFloat(s.rating) : 0,
            readers: s.readers_count
          }));
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error fetching recommended', err)
      });

      if (currentUser && !this.isCurrentUser) {
        this.api.checkFollowStatus(currentUser.id, this.authorId).subscribe({
          next: (data) => {
            this.isFollowing = data.following;
            this.notificationsEnabled = data.enable_notifications !== false;
            this.cdr.detectChanges();
          },
          error: (err) => console.error('Error checking follow status', err)
        });
      }
    }
  }

  toggleFollow() {
    const currentUser = this.auth.currentUser();
    if (!currentUser || !this.authorId || this.isCurrentUser) return;

    if (this.isFollowing) {
      this.api.unfollowUser(currentUser.id, this.authorId).subscribe({
        next: () => {
          this.isFollowing = false;
          this.followersCount = Math.max(0, this.followersCount - 1);
          this.followersList = this.followersList.filter(f => f.id !== currentUser.id);
          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error unfollowing', err)
      });
    } else {
      this.api.followUser(currentUser.id, this.authorId).subscribe({
        next: () => {
          this.isFollowing = true;
          this.notificationsEnabled = true;
          this.followersCount += 1;

          this.followersList.unshift({
            id: currentUser.id,
            name: currentUser.username,
            handle: currentUser.email,
            description: (currentUser as any).bio || '',
            avatar_url: (currentUser as any).avatar_url || '',
            stories_count: 0,
            followers_count: 0,
            following_count: 0
          });

          this.cdr.detectChanges();
        },
        error: (err) => console.error('Error following', err)
      });
    }
  }

  toggleNotifications() {
    const currentUser = this.auth.currentUser();
    if (!currentUser || !this.authorId || !this.isFollowing) return;

    const nextState = !this.notificationsEnabled;
    this.api.toggleFollowNotifications(currentUser.id, this.authorId, nextState).subscribe({
      next: () => {
        this.notificationsEnabled = nextState;
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Error toggling notifications', err)
    });
  }

  private preloadImage(url: string) {
    if (!isPlatformBrowser(this.platformId) || !url) return;
    this.loadingService.show();
    const img = new Image();
    img.onload = () => this.loadingService.hide();
    img.onerror = () => this.loadingService.hide();
    img.src = url;
  }

  toggleLike(book: any) {
    if (book.id) {
      this.interactions.toggleLike(book.id);
    }
  }

  toggleBookmark(book: any) {
    if (book.id) {
      this.interactions.toggleBookmark(book.id);
    }
  }

  navigateToAuthor(authorId: string) {
    if (authorId !== this.authorId) {
      this.authorId = authorId;
      this.loadAuthorData();
      this.router.navigate(['/author'], { state: { authorId } });
    }
  }

  goToAuthor(authorId: string | undefined, event?: Event) {
    if (event) event.stopPropagation();
    if (authorId) {
      this.navigateToAuthor(authorId);
    }
  }

  asAny(val: any): any {
    return val;
  }

  sliceTitle(title: any): string {
    if (!title || typeof title !== 'string') return '';
    return title.slice(0, 2);
  }
}