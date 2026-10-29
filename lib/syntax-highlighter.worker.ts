import { tokenizeCode } from './syntax-highlighter-engine.ts';
import type { SyntaxLanguage } from './syntax-languages.ts';

self.addEventListener(
  'message',
  async (
    event: MessageEvent<{
      id: number;
      source: string;
      language: SyntaxLanguage;
    }>,
  ) => {
    const { id, source, language } = event.data;
    try {
      self.postMessage({ id, tokens: await tokenizeCode(source, language) });
    } catch {
      self.postMessage({ id, tokens: null });
    }
  },
);
