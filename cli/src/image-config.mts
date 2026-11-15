// V2 data-only image discovery for pre-charge recovery. The legacy lexer is diagnostic only.
import { join } from 'node:path';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
export type ImageConfig = { ok: true; image: string } | { ok: false; reason: string };
export function readImageConfig(root: string): ImageConfig {
  const toml = loadTomlConfig(join(root, '.sandcastle'));
  return { ok: true, image: toml.config.image };
}

/** Conservative lexer for a literal legacy CONFIG object, not a TypeScript evaluator. */
export function legacyImage(text: string): string | null {
  const tokens: string[] = [], offsets: number[] = [];
  const pattern = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d[\w.]*|[^\s]/gy;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) if (!/^\s|^\/\/|^\/\*/.test(m[0])) { tokens.push(m[0]); offsets.push(m.index); }
  const declarations = tokens.flatMap((t, i) => t === 'CONFIG' && tokens[i - 1] === 'const' ? [i] : []);
  if (declarations.length !== 1) return null;
  const start = declarations[0];
  // A declaration must start a top-level line, not occur inside a regex, function or other expression.
  const constOffset = offsets[start - 1];
  if (!/^\s*(?:export\s+)?$/.test(text.slice(text.lastIndexOf('\n', constOffset - 1) + 1, constOffset))) return null;
  let nesting = 0;
  for (const token of tokens.slice(0, start - 1)) {
    if (['{', '[', '('].includes(token)) nesting++;
    if (['}', ']', ')'].includes(token)) nesting--;
  }
  if (nesting !== 0) return null;
  let at = start + 2;
  if (tokens[start + 1] !== '=') return null;
  if (tokens[at] === 'effectiveConfig') {
    if (tokens.slice(at, at + 7).join(' ') !== 'effectiveConfig ? effectiveConfig . config : {') return null;
    at += 6;
  }
  if (tokens[at] !== '{') return null;
  let depth = 0, end = -1;
  const properties: string[][] = []; let part: string[] = [];
  for (let i = at; i < tokens.length; i++) {
    const t = tokens[i];
    if (['{', '[', '('].includes(t)) depth++;
    if (['}', ']', ')'].includes(t)) depth--;
    if (depth === 0) { if (part.length) properties.push(part); end = i; break; }
    if (i === at) continue;
    if (depth === 1 && t === ',') { if (part.length) properties.push(part); part = []; } else part.push(t);
  }
  if (end < 0 || tokens[end + 1] !== ';') return null;
  let image: string | null = null;
  const keys = new Set<string>();
  for (const prop of properties) {
    if (!/^[A-Za-z_$][\w$]*$/.test(prop[0]) || prop[1] !== ':' || keys.has(prop[0])) return null;
    keys.add(prop[0]);
    if (prop[0] !== 'image') continue;
    if (prop.length !== 3) return null;
    const literal = prop[2];
    try {
      if (literal.startsWith('"')) image = JSON.parse(literal);
      else if (/^'[^'\\]*'$/.test(literal)) image = literal.slice(1, -1);
      else return null;
    } catch { return null; }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith('`') && tokens[i].includes('CONFIG')) return null;
    if (tokens[i] !== 'CONFIG' || i === start) continue;
    // Only plain property reads are understood, and only outside the declaration.
    if ((i > at && i < end) || tokens[i - 1] === 'delete' || tokens[i + 1] !== '.' || !/^[A-Za-z_$][\w$]*$/.test(tokens[i + 2] ?? '')
      || (tokens[i + 3] !== undefined && ![';', ',', ')', '}', ']'].includes(tokens[i + 3]))) return null;
  }
  return image && typeof image === 'string' && image.trim() ? image : null;
}
