export type ActiveChat = {
  kind: string;
  serviceId: string;
};

let activeChat: ActiveChat | null = null;

export function setActiveChat(chat: ActiveChat | null) {
  activeChat = chat;
}

export function isActiveChat(kind: string, serviceId: string) {
  return activeChat?.kind === kind && activeChat?.serviceId === serviceId;
}
