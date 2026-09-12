/**
 * P4.3 crop images → native draft attachments.
 *
 * The freeze hands back the real crop of what the student selected. Those bytes
 * become browser `File`s and go through the Conversation service's own draft
 * intake, so the picture is owned (and at send time encoded) by the same native
 * attachment path as a pasted image — no second uploader, no base64 smuggled
 * into the prompt text.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConversationController, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { FrozenSource } from '@studyforge/contracts/source-context';
import { decodeBase64 } from './files.ts';

/**
 * Draft creation is implemented by the Conversation controller but is absent
 * from the `IConversation` face the context is typed as; the class is a public
 * export, so the call is cast rather than reimplemented. Reported as a seam.
 */
type DraftOwner = Pick<ConversationController, 'createDrafts'>;

/** The Conversation service's own session identity type. */
type ServiceSessionId = Parameters<ConversationController['createDrafts']>[0];

/** Register one frozen reference's crops as native draft attachments. */
export function mintAttachments(ctx: Context, sessionId: string, images: FrozenSource['images']): readonly DraftAttachmentId[] {
  if (images.length === 0) return [];
  const files = images.map((image, index) => new File(
    [asArrayBuffer(decodeBase64(image.base64))], `选段-${String(index + 1)}.png`, { type: 'image/png' },
  ));
  const owner = ctx.conversation as unknown as DraftOwner;
  if (typeof owner.createDrafts !== 'function') throw new Error('native_draft_intake_unavailable');
  return owner.createDrafts(sessionId as ServiceSessionId, files).map(attachment => attachment.id);
}

/** A copy of the bytes that is a plain ArrayBuffer, which `File` accepts. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
