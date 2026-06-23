const fs = require('node:fs');
const path = require('node:path');

const matter = require('gray-matter');
const MarkdownIt = require('markdown-it');
const MiniSearch = require('minisearch');
const sanitizeHtml = require('sanitize-html');

const config = require('../config');

const DOCS_ROOT = path.join(config.paths.root, 'docs', 'content');

const CATEGORY_META = [
  {
    id: 'integrations',
    title: 'Integrations',
    summary: 'Vendor setup guides and third-party platform integration runbooks.'
  },
  {
    id: 'api-docs',
    title: 'API Docs',
    summary: 'OIDC/OAuth, connected app, and wallet challenge API references.'
  },
  {
    id: 'policy-configuration-and-enforcement',
    title: 'Policy Configuration and Enforcement',
    summary: 'How Aegis ID evaluates policy, assurance, and workspace controls.'
  },
  {
    id: 'workspace-dashboard',
    title: 'Workspace Dashboard',
    summary: 'Operator workflows for managing organizations, credentials, and audit evidence.'
  },
  {
    id: 'rbac',
    title: 'RBAC',
    summary: 'Authorization policy registry, route enforcement, and role/claim model guidance.'
  },
  {
    id: 'wallet-and-passkeys',
    title: 'Wallet & Passkeys',
    summary: 'Mobile wallet, passkey, YubiKey, Aries lab, and challenge testing guides.'
  },
  {
    id: 'architecture-and-design',
    title: 'Architecture and Design',
    summary: 'Architecture decisions, security posture, deployment, and design notes.'
  }
];

const CATEGORY_BY_ID = new Map(CATEGORY_META.map((category) => [category.id, category]));

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

const defaultLinkOpen =
  markdown.renderer.rules.link_open ||
  ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet('href') || '';
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener');
  }
  return defaultLinkOpen(tokens, index, options, env, self);
};

const defaultFence =
  markdown.renderer.rules.fence ||
  ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = (token.info || '').trim().split(/\s+/)[0].toLowerCase();
  if (language === 'mermaid') {
    return `<div class="mermaid" role="img">${escapeHtml(token.content)}</div>\n`;
  }
  return defaultFence(tokens, index, options, env, self);
};

function getDocsWorkspace({ categoryId, slug, query } = {}) {
  const categories = loadCategories();
  const documents = categories.flatMap((category) => category.documents);
  const selected =
    findDocument(documents, categoryId, slug) ||
    searchDocuments(documents, query || '')[0] ||
    documents[0] ||
    null;

  const searchResults = query ? searchDocuments(documents, query) : [];
  const activeCategoryId = selected?.categoryId || categoryId || categories[0]?.id || '';

  return {
    categories: categories.map((category) => ({
      ...category,
      isActive: category.id === activeCategoryId,
      documents: category.documents.map((document) => ({
        ...document,
        isActive: selected?.id === document.id
      }))
    })),
    selected,
    query: query || '',
    hasQuery: Boolean(query),
    searchResults,
    hasSearchResults: searchResults.length > 0,
    documentCount: documents.length
  };
}

function loadCategories() {
  if (!fs.existsSync(DOCS_ROOT)) {
    return [];
  }

  return CATEGORY_META.map((category) => {
    const categoryDir = path.join(DOCS_ROOT, category.id);
    const documents = fs.existsSync(categoryDir)
      ? fs
          .readdirSync(categoryDir)
          .filter((fileName) => fileName.endsWith('.md') && fileName.toLowerCase() !== 'readme.md')
          .sort((left, right) => left.localeCompare(right))
          .map((fileName) => buildDocument(category, path.join(categoryDir, fileName)))
          .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
      : [];

    return {
      ...category,
      count: documents.length,
      documents
    };
  });
}

function buildDocument(category, filePath) {
  const fileName = path.basename(filePath);
  const slug = fileName.replace(/\.md$/i, '');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(raw);
  const title = parsed.data.title || firstHeading(parsed.content) || titleize(slug);
  const summary = parsed.data.summary || firstParagraph(parsed.content) || category.summary;
  const order = Number.parseInt(parsed.data.order || '999', 10);
  const normalizedContent = normalizeDocContent(parsed.content);
  const html = sanitizeRenderedHtml(markdown.render(normalizedContent));

  return {
    id: `${category.id}/${slug}`,
    categoryId: category.id,
    categoryTitle: category.title,
    slug,
    fileName,
    title,
    summary,
    order: Number.isFinite(order) ? order : 999,
    path: filePath,
    href: `/developer/docs/${category.id}/${slug}`,
    html,
    raw: normalizedContent
  };
}

function findDocument(documents, categoryId, slug) {
  if (!categoryId || !slug) {
    return null;
  }
  return documents.find((document) => document.categoryId === categoryId && document.slug === slug) || null;
}

function searchDocuments(documents, query) {
  const normalized = (query || '').trim();
  if (!normalized) {
    return [];
  }

  const index = new MiniSearch({
    fields: ['title', 'summary', 'raw', 'categoryTitle'],
    storeFields: ['id'],
    searchOptions: {
      boost: { title: 4, categoryTitle: 2, summary: 2 },
      fuzzy: 0.18,
      prefix: true
    }
  });

  index.addAll(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      summary: document.summary,
      raw: document.raw,
      categoryTitle: document.categoryTitle
    }))
  );

  const byId = new Map(documents.map((document) => [document.id, document]));
  return index
    .search(normalized)
    .slice(0, 12)
    .map((result) => byId.get(result.id))
    .filter(Boolean);
}

function firstHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function firstParagraph(content) {
  return (
    content
      .replace(/^#.+$/gm, '')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .find((paragraph) => paragraph && !paragraph.startsWith('```')) || ''
  );
}

function titleize(slug) {
  return slug
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeDocContent(content) {
  return content
    .replace(/src=(["'])(?:\.\.\/)+public\/images\//g, 'src=$1/images/')
    .replace(/\]\((?:\.\.\/)+public\/images\//g, '](/images/')
    .replace(/src=(["'])(?:\.\.\/)+public\/docs\//g, 'src=$1/docs/')
    .replace(/\]\((?:\.\.\/)+public\/docs\//g, '](/docs/');
}

function sanitizeRenderedHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      'a',
      'blockquote',
      'br',
      'caption',
      'code',
      'details',
      'div',
      'em',
      'figcaption',
      'figure',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'img',
      'kbd',
      'li',
      'ol',
      'p',
      'pre',
      'small',
      'span',
      'strong',
      'sub',
      'summary',
      'sup',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'ul'
    ],
    allowedAttributes: {
      '*': ['align', 'aria-label', 'class', 'id', 'role', 'title'],
      a: ['href', 'name', 'rel', 'target', 'title'],
      img: ['alt', 'height', 'loading', 'src', 'title', 'width'],
      td: ['align', 'colspan', 'rowspan'],
      th: ['align', 'colspan', 'rowspan']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data']
    },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        if (/^https?:\/\//i.test(href)) {
          return {
            tagName,
            attribs: {
              ...attribs,
              target: '_blank',
              rel: 'noopener'
            }
          };
        }
        return { tagName, attribs };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          loading: 'lazy',
          ...attribs
        }
      })
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCategoryMeta() {
  return CATEGORY_META.map((category) => ({ ...category }));
}

function isKnownCategory(categoryId) {
  return CATEGORY_BY_ID.has(categoryId);
}

module.exports = {
  getCategoryMeta,
  getDocsWorkspace,
  isKnownCategory
};
