import { apiFetch } from './client';

export interface OtherUser {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string | null;
}

export interface ConversationSummary {
  id: string;
  listing: { id: string; title: string; slug: string; thumbnailUrl?: string | null };
  otherUser: OtherUser;
  lastMessageAt: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  listing: ConversationSummary['listing'];
  otherUser: OtherUser;
  messages: ChatMessage[];
  nextCursor: string | null;
}

export function getConversations(token: string): Promise<{ items: ConversationSummary[] }> {
  return apiFetch<{ items: ConversationSummary[] }>('/conversations', { token });
}

export function getConversation(
  id: string,
  token: string,
  opts?: { before?: string; limit?: number },
): Promise<ConversationDetail> {
  const params = new URLSearchParams();
  if (opts?.before) params.set('before', opts.before);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch<ConversationDetail>(`/conversations/${id}${qs}`, { token });
}

export function sendMessage(
  conversationId: string,
  body: string,
  token: string,
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    token,
  });
}

export function startConversation(
  listingId: string,
  message: string,
  token: string,
): Promise<{ id: string; listingId: string; createdAt: string }> {
  return apiFetch('/conversations', {
    method: 'POST',
    body: JSON.stringify({ listingId, message }),
    token,
  });
}
