import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { ExtendedFile } from '@librechat/chat';

/**
 * Files staged for a conversation in a composer the reader is leaving, for the composer that
 * conversation opens under as the page's main chat. In memory, like the text handed over the
 * same way, so they arrive whatever the Save Drafts preference is. Taken once, by main chat's
 * composer, when it holds that conversation.
 */
export const handedComposerFilesFamily = atomFamily((_conversationId: string) =>
  atom<Map<string, ExtendedFile> | null>(null),
);
