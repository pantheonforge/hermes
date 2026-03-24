import hljs from 'highlight.js/lib/core';
import langJS from 'highlight.js/lib/languages/javascript';
import langTS from 'highlight.js/lib/languages/typescript';
import langPY from 'highlight.js/lib/languages/python';
import langJSON from 'highlight.js/lib/languages/json';
import langCSS from 'highlight.js/lib/languages/css';
import langXML from 'highlight.js/lib/languages/xml';
import langBash from 'highlight.js/lib/languages/bash';
import langYAML from 'highlight.js/lib/languages/yaml';
import langRust from 'highlight.js/lib/languages/rust';
import langGo from 'highlight.js/lib/languages/go';
import langMarkdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', langJS);
hljs.registerLanguage('typescript', langTS);
hljs.registerLanguage('python', langPY);
hljs.registerLanguage('json', langJSON);
hljs.registerLanguage('css', langCSS);
hljs.registerLanguage('xml', langXML);
hljs.registerLanguage('bash', langBash);
hljs.registerLanguage('yaml', langYAML);
hljs.registerLanguage('rust', langRust);
hljs.registerLanguage('go', langGo);
hljs.registerLanguage('markdown', langMarkdown);

const EXT_MAP = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'css', sass: 'css',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml',
  rs: 'rust',
  go: 'go',
  md: 'markdown', mdx: 'markdown',
};

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function extFromPath(filePath) {
  const parts = String(filePath || '').split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function getHighlighted(code, filePath) {
  const ext = extFromPath(filePath);
  const lang = EXT_MAP[ext] || null;
  if (!lang) return { html: escHtml(code), language: 'plain' };
  try {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    return { html: result.value, language: lang };
  } catch {
    return { html: escHtml(code), language: 'plain' };
  }
}
