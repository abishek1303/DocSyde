/** Counts only: useful even on truncation, without retaining rejected text or reasoning.
 * JSON whitespace is counted outside strings, so whitespace inside user data is
 * not mistaken for formatting padding. This scanner never tries to repair JSON. */
export function responseTextMetrics(text: string) {
  let quoted = false, escaped = false, jsonWhitespaceCharacters = 0, longestJsonWhitespaceRun = 0, run = 0;
  for (const character of text) {
    if (!quoted && (character === " " || character === "\n" || character === "\r" || character === "\t")) {
      jsonWhitespaceCharacters++; run++; longestJsonWhitespaceRun = Math.max(longestJsonWhitespaceRun, run); continue;
    }
    run = 0;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
  }
  return { bytes: Buffer.byteLength(text, "utf8"), characters: text.length, jsonWhitespaceCharacters, longestJsonWhitespaceRun };
}
