/* ============================================================
   ZETTEL — Main Application
   ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────
const state = {
  cards: [],          // { id, title, type, tags, source, content, links, backlinks, modified, filename, fileHandle }
  dirHandle: null,
  currentView: 'cards',
  activeType: 'all',
  activeTag: null,
  editingCard: null,
  readerCard: null,
  isGridView: true,
  recentIds: [],
};

// ── DOM Refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Utility ──────────────────────────────────────────────────
function generateId() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── YAML Frontmatter Parser ───────────────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta = {};
  match[1].split('\n').forEach(line => {
    const [k, ...v] = line.split(':');
    if (!k) return;
    const key = k.trim();
    let val = v.join(':').trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1,-1).split(',').map(s => s.trim().replace(/^["']|["']$/g,'')).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g,'');
    }
    meta[key] = val;
  });
  return { meta, content: match[2] };
}

function buildFrontmatter(meta, content) {
  const yamlLines = Object.entries(meta).map(([k,v]) => {
    if (Array.isArray(v)) return `${k}: [${v.map(s=>`"${s}"`).join(', ')}]`;
    return `${k}: "${v}"`;
  });
  return `---\n${yamlLines.join('\n')}\n---\n\n${content}`;
}

// ── WikiLink Parser ───────────────────────────────────────────
function extractWikiLinks(content) {
  const re = /\[\[([^\]]+)\]\]/g;
  const links = [];
  let m;
  while ((m = re.exec(content)) !== null) links.push(m[1].trim());
  return [...new Set(links)];
}

function renderWikiLinks(content) {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const target = state.cards.find(c => c.title.toLowerCase() === title.toLowerCase());
    const cls = target ? 'wikilink' : 'wikilink broken';
    const id = target ? target.id : '';
    return `<a class="${cls}" data-target-id="${id}" data-target-title="${title}" href="#">${title}</a>`;
  });
}

// ── File System ───────────────────────────────────────────────
async function openFolder() {
  if (!('showDirectoryPicker' in window)) {
    showToast('File System Access API not supported. Use Chrome/Edge on desktop.', 4000);
    return;
  }
  try {
    state.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    $('folderPath').textContent = state.dirHandle.name;
    $('folderInfo').title = state.dirHandle.name;
    await loadAllFiles();
    showToast(`Opened: ${state.dirHandle.name}`);
  } catch(e) {
    if (e.name !== 'AbortError') showToast('Could not open folder.');
  }
}

async function loadAllFiles() {
  if (!state.dirHandle) return;
  state.cards = [];
  for await (const [name, handle] of state.dirHandle.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.md')) continue;
    try {
      const file = await handle.getFile();
      const raw = await file.text();
      const card = parseMarkdownFile(raw, name, handle);
      card.modified = new Date(file.lastModified).toISOString();
      state.cards.push(card);
    } catch(e) { console.warn('Could not read', name, e); }
  }
  buildBacklinks();
  renderAll();
}

function parseMarkdownFile(raw, filename, fileHandle) {
  const { meta, content } = parseFrontmatter(raw);
  const id = meta.id || filename.replace('.md','');
  return {
    id,
    filename,
    fileHandle,
    title: meta.title || filename.replace('.md',''),
    type: meta.type || 'permanent',
    tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
    source: meta.source || '',
    content,
    links: extractWikiLinks(content),
    backlinks: [],
    modified: meta.modified || '',
  };
}

function buildBacklinks() {
  state.cards.forEach(c => c.backlinks = []);
  state.cards.forEach(card => {
    card.links.forEach(linkTitle => {
      const target = state.cards.find(c => c.title.toLowerCase() === linkTitle.toLowerCase());
      if (target && !target.backlinks.includes(card.title)) {
        target.backlinks.push(card.title);
      }
    });
  });
}

async function saveCardToFile(card) {
  if (!state.dirHandle) {
    showToast('No folder open. Changes saved in memory only.');
    return;
  }
  const meta = {
    id: card.id,
    title: card.title,
    type: card.type,
    tags: card.tags,
    modified: new Date().toISOString(),
  };
  if (card.source) meta.source = card.source;
  const raw = buildFrontmatter(meta, card.content);
  try {
    if (!card.fileHandle) {
      card.filename = card.filename || `${card.id}-${card.title.replace(/[^a-z0-9]/gi,'-').toLowerCase()}.md`;
      card.fileHandle = await state.dirHandle.getFileHandle(card.filename, { create: true });
    }
    const writable = await card.fileHandle.createWritable();
    await writable.write(raw);
    await writable.close();
    showToast('Card saved ✓');
  } catch(e) {
    console.error(e);
    showToast('Save failed. Check folder permissions.');
  }
}

// ── Render ────────────────────────────────────────────────────
function getFilteredCards() {
  let cards = [...state.cards];
  if (state.activeType !== 'all') cards = cards.filter(c => c.type === state.activeType);
  if (state.activeTag) cards = cards.filter(c => c.tags.includes(state.activeTag));
  return cards;
}

function renderAll() {
  renderCards();
  renderTagList();
  updateCardCount();
}

function renderCards() {
  const grid = $('cardsGrid');
  const empty = $('emptyState');
  const filtered = getFilteredCards();
  grid.innerHTML = '';
  if (filtered.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');
  filtered.sort((a,b) => (b.modified||'').localeCompare(a.modified||''));
  filtered.forEach(card => grid.appendChild(createCardEl(card)));
  lucide.createIcons();
}

function createCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.type = card.type;
  el.dataset.id = card.id;
  const tagsHtml = card.tags.slice(0,3).map(t => `<span class="card-tag">${t}</span>`).join('');
  const linksCount = card.links.length + card.backlinks.length;
  el.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escHtml(card.title)}</span>
      <span class="card-type-dot"></span>
    </div>
    <p class="card-excerpt">${escHtml(card.content.slice(0,180).replace(/[#*_`\[\]]/g,''))}</p>
    <div class="card-footer">
      <div class="card-tags">${tagsHtml}</div>
      <div style="display:flex;align-items:center;gap:var(--space-3)">
        ${linksCount > 0 ? `<span class="card-links-count"><i data-lucide="link-2" style="width:11px;height:11px"></i>${linksCount}</span>` : ''}
        <span class="card-date">${formatDate(card.modified)}</span>
      </div>
    </div>`;
  el.addEventListener('click', () => openReader(card.id));
  return el;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderTagList() {
  const tagMap = {};
  state.cards.forEach(c => c.tags.forEach(t => { tagMap[t] = (tagMap[t]||0)+1; }));
  const list = $('tagList');
  list.innerHTML = '';
  Object.entries(tagMap).sort().forEach(([tag, count]) => {
    const el = document.createElement('div');
    el.className = 'tag-list-item' + (state.activeTag === tag ? ' active' : '');
    el.innerHTML = `<span>${tag}</span><span class="tag-count">${count}</span>`;
    el.addEventListener('click', () => {
      state.activeTag = state.activeTag === tag ? null : tag;
      renderAll();
      renderTagList();
    });
    list.appendChild(el);
  });
}

function updateCardCount() {
  $('cardCount').textContent = `${state.cards.length} card${state.cards.length !== 1 ? 's' : ''}`;
}

// ── Reader ────────────────────────────────────────────────────
function openReader(cardId) {
  const card = state.cards.find(c => c.id === cardId);
  if (!card) return;
  state.readerCard = card;

  // Track recent
  state.recentIds = [cardId, ...state.recentIds.filter(id => id !== cardId)].slice(0, 20);

  $('readerTitle').textContent = card.title;
  const typeBadge = $('readerType');
  typeBadge.textContent = card.type;
  typeBadge.className = `type-badge ${card.type}`;

  // Meta tags
  const meta = $('readerMeta');
  meta.innerHTML = '';
  card.tags.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.style.cursor = 'pointer';
    chip.textContent = t;
    chip.addEventListener('click', () => {
      closeReader();
      state.activeTag = t;
      switchView('cards');
      renderAll();
    });
    meta.appendChild(chip);
  });
  if (card.source) {
    const src = document.createElement('span');
    src.style.cssText = 'font-size:var(--text-xs);color:var(--color-text-faint);display:flex;align-items:center;gap:4px';
    src.innerHTML = `<i data-lucide="book-open" style="width:12px;height:12px"></i>${escHtml(card.source)}`;
    meta.appendChild(src);
  }

  // Content
  const htmlContent = renderWikiLinks(card.content);
  $('readerContent').innerHTML = marked.parse(htmlContent);

  // Attach wikilink click handlers
  $('readerContent').querySelectorAll('.wikilink').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const tid = a.dataset.targetId;
      if (tid) openReader(tid);
      else showToast(`"${a.dataset.targetTitle}" not found`);
    });
  });

  // Links
  renderReaderLinks(card);

  $('readerOverlay').classList.add('open');
  lucide.createIcons();
}

function renderReaderLinks(card) {
  const outEl = $('readerOutgoing');
  const backEl = $('readerBacklinks');
  outEl.innerHTML = '';
  backEl.innerHTML = '';

  if (card.links.length === 0) {
    outEl.innerHTML = '<span class="no-links">No outgoing links</span>';
  } else {
    card.links.forEach(title => {
      const target = state.cards.find(c => c.title.toLowerCase() === title.toLowerCase());
      const el = createLinkItem(title, target ? target.type : null);
      if (target) el.addEventListener('click', () => openReader(target.id));
      outEl.appendChild(el);
    });
  }

  if (card.backlinks.length === 0) {
    backEl.innerHTML = '<span class="no-links">No backlinks yet</span>';
  } else {
    card.backlinks.forEach(title => {
      const source = state.cards.find(c => c.title.toLowerCase() === title.toLowerCase());
      const el = createLinkItem(title, source ? source.type : null);
      if (source) el.addEventListener('click', () => openReader(source.id));
      backEl.appendChild(el);
    });
  }
}

function createLinkItem(title, type) {
  const el = document.createElement('div');
  el.className = 'link-item';
  const color = type ? `var(--color-${type})` : 'var(--color-text-faint)';
  el.innerHTML = `<span class="link-item-dot" style="background:${color}"></span><span>${escHtml(title)}</span>`;
  el.style.cursor = 'pointer';
  return el;
}

function closeReader() {
  $('readerOverlay').classList.remove('open');
  state.readerCard = null;
}

// ── Editor ────────────────────────────────────────────────────
function openEditor(card = null) {
  state.editingCard = card;
  $('editorTitle').textContent = card ? 'Edit Card' : 'New Card';
  $('editorCardTitle').value = card ? card.title : '';
  $('editorType').value = card ? card.type : 'permanent';
  $('editorTags').value = card ? card.tags.join(', ') : '';
  $('editorSource').value = card ? (card.source || '') : '';
  $('editorContent').value = card ? card.content : '';
  // reset to write tab
  switchEditorTab('write');
  $('editorOverlay').classList.add('open');
  setTimeout(() => $('editorCardTitle').focus(), 300);
}

function closeEditor() {
  $('editorOverlay').classList.remove('open');
  state.editingCard = null;
}

function switchEditorTab(tab) {
  $$('.editor-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.editor-tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));
  if (tab === 'preview') updatePreview();
  if (tab === 'links') updateEditorLinks();
}

function updatePreview() {
  const content = $('editorContent').value;
  const html = renderWikiLinks(content);
  $('editorPreview').innerHTML = marked.parse(html);
  $('editorPreview').querySelectorAll('.wikilink').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const tid = a.dataset.targetId;
      if (tid) { closeEditor(); openReader(tid); }
    });
  });
}

function updateEditorLinks() {
  const content = $('editorContent').value;
  const links = extractWikiLinks(content);
  const outEl = $('outgoingLinks');
  const backEl = $('backlinks');
  outEl.innerHTML = '';
  backEl.innerHTML = '';

  if (links.length === 0) {
    outEl.innerHTML = '<span class="no-links">No [[wikilinks]] in this card yet</span>';
  } else {
    links.forEach(title => {
      const target = state.cards.find(c => c.title.toLowerCase() === title.toLowerCase());
      const el = createLinkItem(title, target ? target.type : null);
      outEl.appendChild(el);
    });
  }

  if (state.editingCard && state.editingCard.backlinks.length > 0) {
    state.editingCard.backlinks.forEach(title => {
      const source = state.cards.find(c => c.title.toLowerCase() === title.toLowerCase());
      const el = createLinkItem(title, source ? source.type : null);
      backEl.appendChild(el);
    });
  } else {
    backEl.innerHTML = '<span class="no-links">No backlinks yet</span>';
  }
}

async function saveCard() {
  const title = $('editorCardTitle').value.trim();
  if (!title) { showToast('Please enter a title'); return; }

  const tags = $('editorTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const content = $('editorContent').value;
  const type = $('editorType').value;
  const source = $('editorSource').value.trim();

  if (state.editingCard) {
    // Update existing
    const card = state.editingCard;
    card.title = title;
    card.type = type;
    card.tags = tags;
    card.source = source;
    card.content = content;
    card.links = extractWikiLinks(content);
    card.modified = new Date().toISOString();
    buildBacklinks();
    await saveCardToFile(card);
  } else {
    // New card
    const id = generateId();
    const filename = `${id}-${title.replace(/[^a-z0-9]/gi,'-').toLowerCase().slice(0,40)}.md`;
    const card = {
      id, filename, fileHandle: null,
      title, type, tags, source, content,
      links: extractWikiLinks(content),
      backlinks: [],
      modified: new Date().toISOString(),
    };
    state.cards.push(card);
    buildBacklinks();
    await saveCardToFile(card);
  }

  renderAll();
  closeEditor();
}

// ── Graph View ────────────────────────────────────────────────
function renderGraph() {
  const container = $('graphContainer');
  container.innerHTML = '';
  if (state.cards.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-faint);font-size:var(--text-sm)">No cards to display</div>';
    return;
  }

  const w = container.clientWidth || 800;
  const h = container.clientHeight || 500;

  const typeColor = {
    permanent: getComputedStyle(document.documentElement).getPropertyValue('--color-permanent').trim(),
    literature: getComputedStyle(document.documentElement).getPropertyValue('--color-literature').trim(),
    fleeting: getComputedStyle(document.documentElement).getPropertyValue('--color-fleeting').trim(),
  };
  const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim();
  const textMuted = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim();

  const nodes = state.cards.map(c => ({ id: c.id, title: c.title, type: c.type, connections: c.links.length + c.backlinks.length }));
  const links = [];
  state.cards.forEach(card => {
    card.links.forEach(linkTitle => {
      const target = state.cards.find(c => c.title.toLowerCase() === linkTitle.toLowerCase());
      if (target) links.push({ source: card.id, target: target.id });
    });
  });

  const svg = d3.select(container).append('svg').attr('width', w).attr('height', h);

  svg.append('defs').append('marker')
    .attr('id','arrow').attr('viewBox','0 -5 10 10').attr('refX',18).attr('refY',0)
    .attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto')
    .append('path').attr('d','M0,-5L10,0L0,5').attr('fill',borderColor);

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d=>d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(w/2, h/2))
    .force('collision', d3.forceCollide().radius(30));

  const link = svg.append('g').selectAll('line').data(links).join('line')
    .attr('class','graph-link')
    .attr('stroke', borderColor)
    .attr('marker-end','url(#arrow)');

  const node = svg.append('g').selectAll('.graph-node').data(nodes).join('g')
    .attr('class','graph-node')
    .call(d3.drag()
      .on('start', (ev,d) => { if (!ev.active) simulation.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag', (ev,d) => { d.fx=ev.x; d.fy=ev.y; })
      .on('end', (ev,d) => { if (!ev.active) simulation.alphaTarget(0); d.fx=null; d.fy=null; })
    )
    .on('click', (_,d) => openReader(d.id));

  node.append('circle')
    .attr('r', d => Math.min(8 + d.connections * 2, 20))
    .attr('fill', d => typeColor[d.type] || typeColor.permanent)
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => typeColor[d.type] || typeColor.permanent)
    .attr('stroke-width', 1.5);

  node.append('text')
    .attr('dy', d => Math.min(8 + d.connections*2, 20) + 14)
    .attr('text-anchor','middle')
    .attr('fill', textMuted)
    .text(d => d.title.length > 20 ? d.title.slice(0,18)+'…' : d.title);

  simulation.on('tick', () => {
    link
      .attr('x1', d=>d.source.x).attr('y1', d=>d.source.y)
      .attr('x2', d=>d.target.x).attr('y2', d=>d.target.y);
    node.attr('transform', d=>`translate(${d.x},${d.y})`);
  });
}

// ── Recent View ───────────────────────────────────────────────
function renderRecent() {
  const grid = $('recentGrid');
  grid.innerHTML = '';
  const recent = state.recentIds.map(id => state.cards.find(c => c.id === id)).filter(Boolean);
  if (recent.length === 0) {
    grid.innerHTML = '<div class="search-empty">No recently viewed cards yet.</div>';
    return;
  }
  recent.forEach(c => grid.appendChild(createCardEl(c)));
  lucide.createIcons();
}

// ── Search ────────────────────────────────────────────────────
let fuseInstance = null;

function initFuse() {
  fuseInstance = new Fuse(state.cards, {
    keys: ['title', 'content', 'tags', 'source'],
    includeMatches: true,
    threshold: 0.35,
    minMatchCharLength: 2,
  });
}

function doSearch(query, container, emptyMsg = 'Type to search...') {
  if (!query.trim()) { container.innerHTML = `<div class="search-empty">${emptyMsg}</div>`; return; }
  if (!fuseInstance || fuseInstance._docs !== state.cards) initFuse();
  const results = fuseInstance.search(query).slice(0, 30);
  container.innerHTML = '';
  if (results.length === 0) {
    container.innerHTML = `<div class="search-empty">No results for "${escHtml(query)}"</div>`;
    return;
  }
  results.forEach(({ item }) => {
    const el = document.createElement('div');
    el.className = 'search-result';
    const excerpt = item.content.slice(0,200).replace(/[#*_`\[\]]/g,'');
    const highlighted = excerpt.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'), m=>`<mark>${m}</mark>`);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1)">
        <span class="search-result-title">${escHtml(item.title)}</span>
        <span class="type-badge ${item.type}">${item.type}</span>
      </div>
      <div class="search-result-excerpt">${highlighted}…</div>`;
    el.addEventListener('click', () => openReader(item.id));
    container.appendChild(el);
  });
}

// ── CMD Palette ───────────────────────────────────────────────
let cmdFocusIdx = -1;

function openCmdPalette() {
  $('cmdPalette').classList.add('open');
  $('cmdInput').value = '';
  cmdFocusIdx = -1;
  renderCmdResults('');
  setTimeout(() => $('cmdInput').focus(), 50);
}

function closeCmdPalette() {
  $('cmdPalette').classList.remove('open');
}

function renderCmdResults(query) {
  const res = $('cmdResults');
  const commands = [
    { icon: 'plus', title: 'New Card', type: 'command', action: () => { closeCmdPalette(); openEditor(); } },
    { icon: 'folder-open', title: 'Open Folder', type: 'command', action: () => { closeCmdPalette(); openFolder(); } },
    { icon: 'git-branch', title: 'Graph View', type: 'command', action: () => { closeCmdPalette(); switchView('graph'); } },
    { icon: 'settings', title: 'Settings', type: 'command', action: () => { closeCmdPalette(); switchView('settings'); } },
  ];

  let items = [];
  if (!query.trim()) {
    items = commands;
    if (state.cards.length > 0) {
      items = [...commands, ...state.cards.slice(0,8).map(c => ({
        icon: 'file-text', title: c.title, type: c.type, action: () => { closeCmdPalette(); openReader(c.id); }
      }))];
    }
  } else {
    if (!fuseInstance) initFuse();
    const cardResults = fuseInstance.search(query).slice(0,10).map(r => ({
      icon: 'file-text', title: r.item.title, type: r.item.type,
      action: () => { closeCmdPalette(); openReader(r.item.id); }
    }));
    const cmdResults = commands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()));
    items = [...cmdResults, ...cardResults];
  }

  if (items.length === 0) { res.innerHTML = `<div class="cmd-empty">No results for "${escHtml(query)}"</div>`; return; }

  res.innerHTML = '';
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'cmd-item' + (i === cmdFocusIdx ? ' focused' : '');
    el.innerHTML = `<i data-lucide="${item.icon}"></i><span class="cmd-item-title">${escHtml(item.title)}</span><span class="cmd-item-type">${item.type}</span>`;
    el.addEventListener('click', item.action);
    res.appendChild(el);
  });
  lucide.createIcons();
  res._items = items;
}

// ── Views ─────────────────────────────────────────────────────
function switchView(view) {
  state.currentView = view;
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  $$('.nav-item[data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));

  if (view === 'graph') renderGraph();
  if (view === 'recent') renderRecent();
  if (view === 'search') setTimeout(() => $('fullSearch').focus(), 100);
}

// ── Theme Toggle ──────────────────────────────────────────────
let currentTheme = document.documentElement.getAttribute('data-theme') ||
  (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  const btn = $('themeToggle');
  btn.querySelector('span').textContent = currentTheme === 'dark' ? 'Dark Mode' : 'Light Mode';
  btn.querySelector('i').setAttribute('data-lucide', currentTheme === 'dark' ? 'moon' : 'sun');
  lucide.createIcons();
}

// ── Event Listeners ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // Sidebar toggle
  $('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
  $('mobileSidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  });

  // Nav
  $$('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Open folder
  [$('openFolderBtn'), $('emptyOpenBtn'), $('settingsOpenBtn')].forEach(btn => {
    btn?.addEventListener('click', openFolder);
  });
  $('refreshBtn').addEventListener('click', () => { loadAllFiles(); showToast('Refreshed'); });

  // New card
  $('newCardBtn').addEventListener('click', () => openEditor());

  // Type filter chips
  $$('.tag-chip[data-type]').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.tag-chip[data-type]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.activeType = chip.dataset.type;
      renderCards();
    });
  });

  // Grid/List toggle
  $('gridViewBtn').addEventListener('click', () => {
    state.isGridView = true;
    $('cardsGrid').classList.remove('list-view');
    $('gridViewBtn').classList.add('active');
    $('listViewBtn').classList.remove('active');
  });
  $('listViewBtn').addEventListener('click', () => {
    state.isGridView = false;
    $('cardsGrid').classList.add('list-view');
    $('listViewBtn').classList.add('active');
    $('gridViewBtn').classList.remove('active');
  });

  // Quick search (topbar)
  $('quickSearch').addEventListener('input', e => {
    const q = e.target.value.trim();
    if (q.length > 1) {
      switchView('search');
      $('fullSearch').value = q;
      doSearch(q, $('searchResults'), 'Type to search...');
    }
  });

  // Full search
  $('fullSearch').addEventListener('input', e => {
    doSearch(e.target.value, $('searchResults'), 'Type to search...');
  });

  // Editor controls
  $('closeEditor').addEventListener('click', closeEditor);
  $('saveCard').addEventListener('click', saveCard);
  $$('.editor-tab').forEach(tab => {
    tab.addEventListener('click', () => switchEditorTab(tab.dataset.tab));
  });

  // Reader controls
  $('closeReader').addEventListener('click', closeReader);
  $('editFromReader').addEventListener('click', () => {
    const card = state.readerCard;
    closeReader();
    openEditor(card);
  });

  // Overlay close on backdrop click
  $('editorOverlay').addEventListener('click', e => { if (e.target === $('editorOverlay')) closeEditor(); });
  $('readerOverlay').addEventListener('click', e => { if (e.target === $('readerOverlay')) closeReader(); });
  $('cmdPalette').addEventListener('click', e => { if (e.target === $('cmdPalette')) closeCmdPalette(); });

  // Theme
  $('themeToggle').addEventListener('click', toggleTheme);

  // CMD Palette
  $('cmdInput').addEventListener('input', e => renderCmdResults(e.target.value));
  $('cmdInput').addEventListener('keydown', e => {
    const items = $('cmdResults')._items || [];
    if (e.key === 'ArrowDown') { cmdFocusIdx = Math.min(cmdFocusIdx+1, items.length-1); }
    else if (e.key === 'ArrowUp') { cmdFocusIdx = Math.max(cmdFocusIdx-1, 0); }
    else if (e.key === 'Enter' && cmdFocusIdx >= 0) { items[cmdFocusIdx].action(); return; }
    else if (e.key === 'Escape') { closeCmdPalette(); return; }
    $$('.cmd-item').forEach((el,i) => el.classList.toggle('focused', i === cmdFocusIdx));
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(tag);

    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmdPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); openEditor(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && $('editorOverlay').classList.contains('open')) { e.preventDefault(); saveCard(); return; }
    if (e.key === 'Escape') {
      if ($('cmdPalette').classList.contains('open')) { closeCmdPalette(); return; }
      if ($('editorOverlay').classList.contains('open')) { closeEditor(); return; }
      if ($('readerOverlay').classList.contains('open')) { closeReader(); return; }
    }
    if (e.key === '?' && !inInput) {
      switchView('settings');
      return;
    }
  });

  // PWA install
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').style.display = 'flex';
    $('installHint').style.display = 'none';
  });
  $('installBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') showToast('App installed!');
    deferredPrompt = null;
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Demo cards if no folder
  loadDemoCards();
});

// ── Demo Cards ────────────────────────────────────────────────
function loadDemoCards() {
  const demos = [
    {
      id: '20260406-0001', filename: 'demo-fatigue-metacognition.md', fileHandle: null,
      title: 'Fatigue Degrades Metacognition Before Performance',
      type: 'permanent',
      tags: ['fatigue', 'aviation-safety', 'cognition'],
      source: 'Caldwell et al., 2009',
      content: `Pilots experiencing acute sleep deprivation lose the ability to accurately assess their own impairment **before** objective task performance measurably degrades.\n\nThis is especially dangerous in single-pilot operations, because the impaired crew member has no external check on their self-assessment.\n\n## Implications\n\n- Self-reporting of fatigue is unreliable when fatigued\n- KSS may underestimate true impairment\n- See [[KSS Scale Calibration Issues]]\n\nRelates to [[FAR 117 Rest Requirements]] — the regulation assumes pilots can self-assess fitness for duty.`,
      links: ['KSS Scale Calibration Issues', 'FAR 117 Rest Requirements'],
      backlinks: [],
      modified: new Date().toISOString(),
    },
    {
      id: '20260406-0002', filename: 'demo-far117.md', fileHandle: null,
      title: 'FAR 117 Rest Requirements',
      type: 'literature',
      tags: ['regulations', 'FAR-117', 'rest'],
      source: 'FAA FAR Part 117',
      content: `FAR 117 governs flight and duty time limitations for Part 121 air carriers. Key provisions:\n\n- Minimum rest period: 10 hours prior to report time\n- 8 hours of undisturbed sleep opportunity within that rest period\n- WOCL (Window of Circadian Low) restrictions on flight time\n\n## Augmented Crew\n\nAugmented crew provisions allow extended flight duty periods when an additional qualified pilot is added to the crew, permitting in-flight rest in a bunk or seat.\n\nSee [[Fatigue Degrades Metacognition Before Performance]] for why self-assessment limitations are a gap in this framework.\n\nSee also [[PIBC Requirements]].`,
      links: ['Fatigue Degrades Metacognition Before Performance', 'PIBC Requirements'],
      backlinks: [],
      modified: new Date().toISOString(),
    },
    {
      id: '20260406-0003', filename: 'demo-pibc.md', fileHandle: null,
      title: 'PIBC Requirements',
      type: 'permanent',
      tags: ['regulations', 'PIBC', 'pre-departure'],
      source: '',
      content: `PIBC (Pre-flight, In-flight, and Post-flight Briefing and Checklist) requirements mandate structured communication among crew members before and during operations.\n\nKey elements include:\n- Fatigue self-declaration at sign-in\n- Crew resource management briefings\n- Sterile cockpit enforcement below 10,000 ft\n\nRelated: [[FAR 117 Rest Requirements]]`,
      links: ['FAR 117 Rest Requirements'],
      backlinks: [],
      modified: new Date().toISOString(),
    },
    {
      id: '20260406-0004', filename: 'demo-kss.md', fileHandle: null,
      title: 'KSS Scale Calibration Issues',
      type: 'literature',
      tags: ['fatigue', 'measurement', 'KSS'],
      source: 'Åkerstedt & Gillberg, 1990',
      content: `The Karolinska Sleepiness Scale (KSS) is a 9-point self-report scale measuring subjective sleepiness. While widely used, it has calibration limitations:\n\n1. Anchoring bias — responses cluster toward middle values\n2. Social desirability — crew may underreport fatigue to remain on duty\n3. Insensitivity at extreme fatigue — scale ceiling effects\n\nDespite these issues, KSS remains one of the most validated tools for real-time fatigue monitoring in operational settings.\n\nSee [[Fatigue Degrades Metacognition Before Performance]] for how impaired self-awareness compounds KSS limitations.`,
      links: ['Fatigue Degrades Metacognition Before Performance'],
      backlinks: [],
      modified: new Date().toISOString(),
    },
    {
      id: '20260406-0005', filename: 'demo-dissertation.md', fileHandle: null,
      title: 'Dissertation Research Overview',
      type: 'fleeting',
      tags: ['dissertation', 'research', 'planning'],
      source: '',
      content: `Working notes for Ed.D dissertation on pilot fatigue and safety culture.\n\n## Research Questions\n- How do pilots self-assess fatigue under current FAR 117 frameworks?\n- Does organizational safety culture moderate fatigue reporting behavior?\n- Are biomathematical models (FAST) predictive of subjective KSS scores?\n\n## Methodology\n- Convergent-parallel mixed methods\n- Likert-scale survey via Qualtrics\n- Regression and reliability analysis\n\n## Key Sources to Develop\nSee [[FAR 117 Rest Requirements]], [[KSS Scale Calibration Issues]], [[Fatigue Degrades Metacognition Before Performance]]`,
      links: ['FAR 117 Rest Requirements', 'KSS Scale Calibration Issues', 'Fatigue Degrades Metacognition Before Performance'],
      backlinks: [],
      modified: new Date().toISOString(),
    },
  ];

  state.cards = demos;
  buildBacklinks();
  renderAll();
  initFuse();
}
