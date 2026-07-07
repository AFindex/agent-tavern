const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface PngTextChunk {
  keyword: string;
  text: string;
}

export async function readImportFile(
  file: File,
  kind: "character" | "lorebook",
): Promise<unknown> {
  if (isPngFile(file)) {
    if (kind !== "character") {
      throw new Error("PNG character cards should be imported as characters.");
    }

    return readPngCharacterCard(file);
  }

  return JSON.parse(await file.text()) as unknown;
}

async function readPngCharacterCard(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  ensurePng(bytes, file.name);

  for (const chunk of readPngTextChunks(bytes)) {
    if (chunk.keyword !== "chara") {
      continue;
    }

    return parseCharaPayload(chunk.text, file.name);
  }

  throw new Error(`${file.name} does not contain a SillyTavern chara chunk.`);
}

export function isPngFile(file: File): boolean {
  return file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
}

function ensurePng(bytes: Uint8Array, fileName: string): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new Error(`${fileName} is not a valid PNG file.`);
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error(`${fileName} is not a valid PNG file.`);
    }
  }
}

function readPngTextChunks(bytes: Uint8Array): PngTextChunk[] {
  const chunks: PngTextChunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    offset += 4;
    const type = ascii(bytes.subarray(offset, offset + 4));
    offset += 4;

    const dataStart = offset;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error("PNG chunk length is invalid.");
    }

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "tEXt") {
      const chunk = parseTextChunk(data);
      if (chunk) chunks.push(chunk);
    }
    if (type === "iTXt") {
      const chunk = parseInternationalTextChunk(data);
      if (chunk) chunks.push(chunk);
    }

    offset = dataEnd + 4;
    if (type === "IEND") {
      break;
    }
  }

  return chunks;
}

function parseTextChunk(data: Uint8Array): PngTextChunk | null {
  const separator = data.indexOf(0);
  if (separator < 0) {
    return null;
  }

  return {
    keyword: ascii(data.subarray(0, separator)),
    text: ascii(data.subarray(separator + 1)),
  };
}

function parseInternationalTextChunk(data: Uint8Array): PngTextChunk | null {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 0 || keywordEnd + 3 >= data.length) {
    return null;
  }

  const keyword = ascii(data.subarray(0, keywordEnd));
  const compressionFlag = data[keywordEnd + 1];
  if (compressionFlag !== 0) {
    throw new Error("Compressed PNG iTXt character chunks are not supported yet.");
  }

  let cursor = keywordEnd + 3;
  const languageEnd = data.indexOf(0, cursor);
  if (languageEnd < 0) {
    return null;
  }

  cursor = languageEnd + 1;
  const translatedEnd = data.indexOf(0, cursor);
  if (translatedEnd < 0) {
    return null;
  }

  cursor = translatedEnd + 1;
  return {
    keyword,
    text: new TextDecoder().decode(data.subarray(cursor)),
  };
}

function parseCharaPayload(value: string, fileName: string): unknown {
  const text = value.trim().startsWith("{")
    ? value.trim()
    : decodeBase64Utf8(value.trim());

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${fileName} contains an invalid SillyTavern chara payload.`);
  }
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function ascii(bytes: Uint8Array): string {
  let value = "";

  for (let index = 0; index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }

  return value;
}
