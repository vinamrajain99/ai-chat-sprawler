import type { ChatAppAdapter } from './types';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';

const adapters: ChatAppAdapter[] = [chatgptAdapter, claudeAdapter, geminiAdapter];

export function findAdapter(url: string = window.location.href): ChatAppAdapter | null {
  return adapters.find((a) => a.matches(url)) ?? null;
}

export type { ChatAppAdapter } from './types';
