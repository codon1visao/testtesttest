import { describe, expect, it } from "vitest";
import { FrameTooLargeError, MalformedFrameError } from "./errors.js";
import { encodeFrame, FRAME_HEADER_BYTES, FrameDecoder } from "./frame-codec.js";

const MAX = 1024;
const a = { requestId: "a", text: "Clear directions. 🙂" };
const b = { requestId: "b", text: "Second" };

function header(length: number): Buffer {
  const buffer = Buffer.alloc(FRAME_HEADER_BYTES);
  buffer.writeUInt32BE(length, 0);
  return buffer;
}

describe("encodeFrame", () => {
  it("prefixes the UTF-8 JSON body with its byte length (uint32 BE)", () => {
    const frame = encodeFrame(a, MAX);
    const body = Buffer.from(JSON.stringify(a), "utf8");
    expect(frame.readUInt32BE(0)).toBe(body.byteLength);
    expect(frame.subarray(FRAME_HEADER_BYTES)).toEqual(body);
  });

  it("refuses a message larger than the limit", () => {
    expect(() => encodeFrame({ text: "x".repeat(MAX) }, MAX)).toThrow(FrameTooLargeError);
  });
});

describe("FrameDecoder", () => {
  it("F8-05: decodes a frame delivered one byte at a time", () => {
    const decoder = new FrameDecoder(MAX);
    const frame = encodeFrame(a, MAX);
    const messages = [];
    for (const byte of frame) messages.push(...decoder.push(Buffer.from([byte])));
    expect(messages).toEqual([a]);
  });

  it("F8-05: decodes two frames combined in one chunk, and a split header", () => {
    const decoder = new FrameDecoder(MAX);
    const both = Buffer.concat([encodeFrame(a, MAX), encodeFrame(b, MAX)]);
    expect(decoder.push(both)).toEqual([a, b]);

    const next = encodeFrame(a, MAX);
    expect(decoder.push(next.subarray(0, 2))).toEqual([]);
    expect(decoder.push(next.subarray(2))).toEqual([a]);
  });

  it("rejects an oversized declared length before the body arrives", () => {
    const decoder = new FrameDecoder(MAX);
    expect(() => decoder.push(header(MAX + 1))).toThrow(FrameTooLargeError);
  });

  it("rejects empty frames, invalid UTF-8, invalid JSON and non-object messages", () => {
    const frames = [
      header(0),
      Buffer.concat([header(2), Buffer.from([0xc3, 0x28])]),
      Buffer.concat([header(5), Buffer.from("{oops", "utf8")]),
      Buffer.concat([header(2), Buffer.from("[]", "utf8")]),
      Buffer.concat([header(4), Buffer.from("null", "utf8")]),
    ];
    for (const frame of frames) {
      expect(() => new FrameDecoder(MAX).push(frame)).toThrow(MalformedFrameError);
    }
  });
});
