#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const matter = require('gray-matter');

const rootDir = path.resolve(__dirname, '..');
const docsRoot = path.join(rootDir, 'docs', 'content');
const errors = [];

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

function validateMarkdown(filePath) {
  const relativePath = path.relative(rootDir, filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed;

  try {
    parsed = matter(raw);
  } catch (error) {
    errors.push(`${relativePath}: invalid frontmatter: ${error.message}`);
    return;
  }

  const markdownBody = stripCode(parsed.content);
  const headingCount = (markdownBody.match(/^#\s+/gm) || []).length;
  if (headingCount < 1) {
    errors.push(`${relativePath}: Markdown files must include a top-level heading`);
  }

  raw.split('\n').forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      errors.push(`${relativePath}:${index + 1}: trailing whitespace`);
    }
  });

  validateLinks(filePath, parsed.content);
}

function validateLinks(filePath, content) {
  const relativePath = path.relative(rootDir, filePath);
  const markdownLinkRegex = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const rawUrlRegex = /\bhttps?:\/\/[^\s<>)]+/g;
  const links = new Set();
  const linkSource = stripCode(content);

  for (const match of linkSource.matchAll(markdownLinkRegex)) {
    links.add(match[1]);
  }

  for (const match of linkSource.matchAll(rawUrlRegex)) {
    links.add(match[0].replace(/[.,;:]+$/, ''));
  }

  for (const href of links) {
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) {
      continue;
    }

    if (/^https?:\/\//i.test(href)) {
      if (!href.startsWith('https://') && !isLocalHttpExample(href)) {
        errors.push(`${relativePath}: external links must use HTTPS: ${href}`);
      }
      continue;
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      continue;
    }

    const [target] = href.split('#');
    if (!target) {
      continue;
    }

    if (target.startsWith('/')) {
      const publicTargetPath = path.join(rootDir, 'public', target);
      if (fs.existsSync(publicTargetPath) || isAppRoute(target)) {
        continue;
      }
      errors.push(`${relativePath}: broken app/public link: ${href}`);
      continue;
    }

    const targetPath = path.resolve(path.dirname(filePath), decodeURIComponent(target));
    if (!targetPath.startsWith(rootDir) || !fs.existsSync(targetPath)) {
      errors.push(`${relativePath}: broken internal link: ${href}`);
    }
  }
}

function stripCode(content) {
  return content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
}

function isLocalHttpExample(href) {
  try {
    const url = new URL(href);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]' ||
        url.hostname.startsWith('192.168.') ||
        url.hostname.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname))
    );
  } catch (_error) {
    return false;
  }
}

function isAppRoute(target) {
  return /^\/(account|api|architecture|dashboard|developer|health|oauth2|subscribe)(\/|$)/.test(target);
}

for (const filePath of walk(docsRoot)) {
  validateMarkdown(filePath);
}

if (errors.length) {
  console.error('Documentation validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Documentation validation passed.');
