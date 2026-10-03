import { FrameTooLargeError, MalformedFrameError } from "./errors.js";

export type RpcMessage = Record<string, unknown>;

export const FRAME_HEADER_BYTES = 4;
/** F8 frame ceilings: 64 KiB per request, 128 KiB per response. */
export const DEFAULT_LIMITS = { maxRequestBytes: 64 * 1024, maxResponseBytes: 128 * 1024 } as const;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** `uint32 BE` byte length, then the UTF-8 JSON body. */
export function encodeFrame(message: RpcMessage, maxBytes: number): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.byteLength > maxBytes) throw new FrameTooLargeError(body.byteLength, maxBytes);
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([header, body]);
}

function parseBody(body: Uint8Array): RpcMessage {
  let value: unknown;
  try {
    value = JSON.parse(utf8.decode(body));
  } catch (error) {
    throw new MalformedFrameError(
      error instanceof SyntaxError ? "Frame is not valid JSON" : "Frame is not valid UTF-8",
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MalformedFrameError("Frame must hold a JSON object");
  }
  return value as RpcMessage;
}

/**
 * Streaming decoder: TCP chunks are not messages (F8). Fragmented and combined chunks yield exactly
 * the framed messages; a declared length over the limit is rejected before its body is buffered.
 */
export class FrameDecoder {
  private readonly maxBytes: number;
  private buffered: Buffer = Buffer.alloc(0);

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  push(chunk: Buffer): RpcMessage[] {
    this.buffered = this.buffered.byteLength === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    const messages: RpcMessage[] = [];
    while (this.buffered.byteLength >= FRAME_HEADER_BYTES) {
      const length = this.buffered.readUInt32BE(0);
      if (length === 0) throw new MalformedFrameError("Frame is empty");
      if (length > this.maxBytes) throw new FrameTooLargeError(length, this.maxBytes);
      const end = FRAME_HEADER_BYTES + length;
      if (this.buffered.byteLength < end) break;
      messages.push(parseBody(this.buffered.subarray(FRAME_HEADER_BYTES, end)));
      this.buffered = this.buffered.subarray(end);
    }
    return messages;
  }
}
