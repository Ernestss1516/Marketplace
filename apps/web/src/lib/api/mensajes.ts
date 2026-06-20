import { apiFetch } from './client';

export interface ConversationSummary {
  id: string;
  listing: { id: string; title: string; slug: string; thumbnailUrl?: string };
  otherUser: { name: string; slug: string };
  lastMessageAt: string;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  readAt?: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  listing: ConversationSummary['listing'];
  otherUser: ConversationSummary['otherUser'];
  messages: ChatMessage[];
}

export function getConversations(token: string): Promise<{ items: ConversationSummary[] }> {
  return apiFetch<{ items: ConversationSummary[] }>('/conversations', { token });
}

export function getConversation(
  id: string,
  token: string,
  page = 1,
): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/conversations/${id}?page=${page}`, { token });
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
): Promise<{ id: string; listingId: string }> {
  return apiFetch('/conversations', {
    method: 'POST',
    body: JSON.stringify({ listingId, message }),
    token,
  });
}
