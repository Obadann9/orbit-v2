import type { Response } from "express";

type RealtimeNotification = {
  id?: number;
  type: "task" | "withdrawal" | "system";
  title: string;
  body: string;
  createdAt?: Date;
};

const subscribers = new Map<number, Set<Response>>();

export function subscribeToUser(userId: number, response: Response) {
  const current = subscribers.get(userId) ?? new Set<Response>();
  current.add(response);
  subscribers.set(userId, current);
  return () => {
    current.delete(response);
    if (current.size === 0) subscribers.delete(userId);
  };
}

export function publishToUser(
  userId: number,
  notification: RealtimeNotification
) {
  const current = subscribers.get(userId);
  if (!current) return;
  const payload = `data: ${JSON.stringify({ ...notification, createdAt: notification.createdAt?.toISOString() ?? new Date().toISOString() })}\n\n`;
  current.forEach(response => response.write(payload));
}
