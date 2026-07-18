import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})

export class Api {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient, private authService: AuthService) {}

  private filter18Plus(stories: any[] | null | undefined): any[] {
    if (!stories) return [];
    const show18Plus = this.authService.currentUser()?.visualizza_18plus === true;
    if (show18Plus) return stories;
    return stories.filter(s => !s.is_18_plus);
  }


  getUsers() {
    return this.http.get(`${this.apiUrl}/api/user`);
  }

  getUserProfile(id: string) {
    return this.http.post<any>(`${this.apiUrl}/api/user/profile`, { id });
  }

  updateUserProfile(id: string, data: any) {
    return this.http.put<any>(`${this.apiUrl}/api/user/${id}`, data);
  }

  login(email: string, password: string) {
    return this.http.post(`${this.apiUrl}/api/user/login`, { email, password });
  }

  register(email: string, username: string, password: string) {
    return this.http.post(`${this.apiUrl}/api/user/register`, { email, username, password });
  }

  sendVerificationCode(email: string) {
    return this.http.post<any>(`${this.apiUrl}/api/email/send-code`, { email });
  }

  verifyCode(email: string, code: string) {
    return this.http.post<any>(`${this.apiUrl}/api/email/verify-code`, { email, code });
  }

  // ═══════════════ LIKES ═══════════════

  toggleLike(userId: string, storyId: string) {
    return this.http.post<{ liked: boolean }>(`${this.apiUrl}/api/likes/toggle`, { user_id: userId, story_id: storyId });
  }

  getLikedIds(userId: string) {
    return this.http.get<string[]>(`${this.apiUrl}/api/likes/${userId}`);
  }

  getLikedStories(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/likes/${userId}/stories`);
  }

  // ═══════════════ BOOKMARKS ═══════════════

  toggleBookmark(userId: string, storyId: string) {
    return this.http.post<{ bookmarked: boolean }>(`${this.apiUrl}/api/bookmarks/toggle`, { user_id: userId, story_id: storyId });
  }

  getBookmarkedIds(userId: string) {
    return this.http.get<string[]>(`${this.apiUrl}/api/bookmarks/${userId}`);
  }

  getBookmarkedStories(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/bookmarks/${userId}/stories`);
  }

  // ═══════════════ STORIES ═══════════════

  getStories() {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getStory(id: string) {
    return this.http.get<any>(`${this.apiUrl}/api/stories/${id}`);
  }

  getPopularStories() {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/popular`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getStoriesByGenre(genre: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/genre/${genre}`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getTrendingStories(userId?: string) {
    let url = `${this.apiUrl}/api/stories/trending`;
    if (userId) url += `?userId=${userId}`;
    return this.http.get<any[]>(url).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getSimilarStories(storyId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/similar/${storyId}`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getContinueReading(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/continue/${userId}`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getFavoritesBasedStories(userId?: string) {
    const url = userId 
      ? `${this.apiUrl}/api/stories/favorites-based/${userId}`
      : `${this.apiUrl}/api/stories/favorites-based/anonymous`;
    return this.http.get<any[]>(url).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getRecommendedStories(userId?: string) {
    const url = userId
      ? `${this.apiUrl}/api/stories/recommended/${userId}`
      : `${this.apiUrl}/api/stories/recommended/anonymous`;
    return this.http.get<any[]>(url).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getNewTalents() {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/new-talents`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getQuickReads() {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/quick-reads`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getPopularAuthors() {
    return this.http.get<any[]>(`${this.apiUrl}/api/authors/popular`);
  }

  getStoriesByCompletionStatus(status: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/completion/${status}`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  getNsfwStories() {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/nsfw`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  // ═══════════════ VIEWS ═══════════════

  recordView(storyId: string, userId?: string) {
    return this.http.post(`${this.apiUrl}/api/views`, { story_id: storyId, user_id: userId });
  }

  // ═══════════════ READING PROGRESS ═══════════════

  getReadingProgress(userId: string, storyId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/progress/${userId}/${storyId}`);
  }

  saveReadingProgress(userId: string, chapterId: string, progressPct: number) {
    return this.http.post(`${this.apiUrl}/api/progress`, {
      user_id: userId,
      chapter_id: chapterId,
      progress_pct: progressPct
    });
  }

  resetReadingProgress(userId: string, storyId: string) {
    return this.http.delete(`${this.apiUrl}/api/progress/${userId}/${storyId}`);
  }

  // ═══════════════ CHAPTERS ═══════════════

  getChapters(storyId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/${storyId}/chapters`);
  }

  getAuthorChapters(storyId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/author/stories/${storyId}/chapters`);
  }

  getChapter(chapterId: string) {
    return this.http.get<any>(`${this.apiUrl}/api/chapters/${chapterId}`);
  }

  // ═══════════════ REVIEWS & COMMENTS ═══════════════

  getStoryReviews(storyId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/${storyId}/reviews`);
  }

  getStoryComments(storyId: string, userId?: string) {
    let url = `${this.apiUrl}/api/stories/${storyId}/comments`;
    if (userId) url += `?userId=${userId}`;
    return this.http.get<any[]>(url);
  }

  addComment(storyId: string, authorId: string, content: string) {
    return this.http.post<any>(`${this.apiUrl}/api/stories/${storyId}/comments`, { author_id: authorId, content });
  }

  addReply(commentId: string, authorId: string, content: string) {
    return this.http.post<any>(`${this.apiUrl}/api/comments/${commentId}/replies`, { author_id: authorId, content });
  }

  toggleCommentLike(commentId: string, userId: string) {
    return this.http.post<{ liked: boolean }>(`${this.apiUrl}/api/comments/${commentId}/like`, { user_id: userId });
  }

  toggleReplyLike(replyId: string, userId: string) {
    return this.http.post<{ liked: boolean }>(`${this.apiUrl}/api/comments/replies/${replyId}/like`, { user_id: userId });
  }

  // ═══════════════ FOLLOWS & AUTHORS ═══════════════

  followUser(followerId: string, followedId: string) {
    return this.http.post<{ success: boolean }>(`${this.apiUrl}/api/follows`, { follower_id: followerId, followed_id: followedId });
  }

  unfollowUser(followerId: string, followedId: string) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/follows/${followerId}/${followedId}`);
  }

  getFollowedAuthors(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/follows/${userId}`);
  }

  getAuthorFollowers(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/follows/followers/${userId}`);
  }

  getFollowsCount(userId: string) {
    return this.http.get<{ followersCount: number, followingCount: number }>(`${this.apiUrl}/api/follows/count/${userId}`);
  }

  checkFollowStatus(followerId: string, followedId: string) {
    return this.http.get<{ following: boolean, enable_notifications?: boolean }>(`${this.apiUrl}/api/follows/check/${followerId}/${followedId}`);
  }

  toggleFollowNotifications(followerId: string, followedId: string, enableNotifications: boolean) {
    return this.http.put<{ success: boolean }>(`${this.apiUrl}/api/follows/notifications`, {
      follower_id: followerId,
      followed_id: followedId,
      enable_notifications: enableNotifications
    });
  }

  getAuthorStories(authorId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/stories/author/${authorId}`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  // ═══════════════ USER SETTINGS & RECOMMENDED ═══════════════

  getAuthorRecommended(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/user/${userId}/recommended`).pipe(
      map(stories => this.filter18Plus(stories))
    );
  }

  updateAuthorRecommended(userId: string, storyIds: string[]) {
    return this.http.put<{ success: boolean }>(`${this.apiUrl}/api/user/${userId}/recommended`, { storyIds });
  }

  // ═══════════════ AUTHOR DASHBOARD & EDITOR ═══════════════

  getAuthorDashboardStories(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/author/my-stories/${userId}`);
  }

  createStory(storyData: any) {
    return this.http.post<any>(`${this.apiUrl}/api/stories`, storyData);
  }

  updateStory(storyId: string, storyData: any) {
    return this.http.put<any>(`${this.apiUrl}/api/stories/${storyId}`, storyData);
  }

  deleteStory(storyId: string) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/stories/${storyId}`);
  }

  createChapter(chapterData: any) {
    return this.http.post<any>(`${this.apiUrl}/api/chapters`, chapterData);
  }

  updateChapter(chapterId: string, chapterData: any) {
    return this.http.put<any>(`${this.apiUrl}/api/chapters/${chapterId}`, chapterData);
  }

  deleteChapter(chapterId: string) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/chapters/${chapterId}`);
  }

  search(query: string) {
    return this.http.get<{ stories: any[], authors: any[], genres: string[] }>(`${this.apiUrl}/api/search?q=${query}`).pipe(
      map(res => ({
        ...res,
        stories: this.filter18Plus(res.stories)
      }))
    );
  }

  // ═══════════════ NOTIFICATIONS ═══════════════

  getNotifications(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/notifications/${userId}`);
  }

  markNotificationAsRead(id: string) {
    return this.http.put<any>(`${this.apiUrl}/api/notifications/${id}/read`, {});
  }

  markAllNotificationsAsRead(userId: string) {
    return this.http.put<any>(`${this.apiUrl}/api/notifications/user/${userId}/read-all`, {});
  }

  // ═══════════════ COLLECTIONS ═══════════════

  getCollections(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/users/${userId}/collections`);
  }

  createCollection(userId: string, data: { name: string, description: string, type?: string, storyIds?: string[], highlightIds?: string[] }) {
    return this.http.post<any>(`${this.apiUrl}/api/users/${userId}/collections`, data);
  }

  updateCollection(collectionId: string, data: { name: string, description: string, type?: string, storyIds?: string[], highlightIds?: string[] }) {
    return this.http.put<any>(`${this.apiUrl}/api/collections/${collectionId}`, data);
  }

  deleteCollection(collectionId: string) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/collections/${collectionId}`);
  }

  // ═══════════════ SERIES ═══════════════

  getSeries(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/users/${userId}/series`);
  }

  createSeries(userId: string, data: { name: string, description: string, storyIds?: string[] }) {
    return this.http.post<any>(`${this.apiUrl}/api/users/${userId}/series`, data);
  }

  updateSeries(seriesId: string, data: { name: string, description: string, storyIds?: string[] }) {
    return this.http.put<any>(`${this.apiUrl}/api/series/${seriesId}`, data);
  }

  deleteSeries(seriesId: string) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/series/${seriesId}`);
  }

  getAuthorSeries(authorId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/authors/${authorId}/series`);
  }

  // ═══════════════ HIGHLIGHTS ═══════════════

  getCommunityHighlights() {
    return this.http.get<any[]>(`${this.apiUrl}/api/community/highlights`);
  }

  getChapterHighlights(chapterId: string, userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/chapters/${chapterId}/highlights?userId=${userId}`);
  }

  getUserHighlights(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/users/${userId}/highlights`);
  }

  addHighlight(data: { userId: string, storyId: string, chapterId: string, paragraphIndex: number, startOffset: number, endOffset: number, text: string, color?: string }) {
    return this.http.post<any>(`${this.apiUrl}/api/highlights`, data);
  }

  deleteHighlight(highlightId: string) {
    return this.http.delete<any>(`${this.apiUrl}/api/highlights/${highlightId}`);
  }

  updateHighlight(highlightId: string, data: { color?: string, startOffset?: number, endOffset?: number, text?: string }) {
    return this.http.put<any>(`${this.apiUrl}/api/highlights/${highlightId}`, data);
  }

  // ═══════════════ COMMUNITY ═══════════════

  getCommunityPosts(userId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/community/posts?userId=${userId}`);
  }

  createCommunityPost(postData: any) {
    return this.http.post<any>(`${this.apiUrl}/api/community/posts`, postData);
  }

  voteCommunityPost(postId: string, userId: string, vote: 'like' | 'dislike') {
    return this.http.post<{ success: boolean, user_vote: 'like' | 'dislike' | null, likes_count: number, dislikes_count: number }>(`${this.apiUrl}/api/community/posts/${postId}/vote`, { userId, vote });
  }

  toggleCommunityPostBookmark(postId: string, userId: string) {
    return this.http.post<{ success: boolean, bookmarked: boolean }>(`${this.apiUrl}/api/community/posts/${postId}/bookmark`, { userId });
  }

  getCommunityPostComments(postId: string) {
    return this.http.get<any[]>(`${this.apiUrl}/api/community/posts/${postId}/comments`);
  }

  addCommunityPostComment(postId: string, userId: string, content: string) {
    return this.http.post<any>(`${this.apiUrl}/api/community/posts/${postId}/comments`, { userId, content });
  }

  deleteCommunityPost(postId: string) {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/community/posts/${postId}`);
  }
}

