'use strict';

const state = {
  cards: [],
  dirHandle: null,
  currentView: 'cards',
  activeType: 'all',
  activeTag: null,
  editingCard: null,
  readerCard: null,
  recentIds: [],
  currentTheme: document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

function escHtml(str='') { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function generateId() { const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`; }
function formatDate(iso){ if(!iso) return ''; return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function showToast(msg, duration=2400){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),duration); }

function openMobileSidebar(){ $('sidebar').classList.add('mobile-open'); $('mobileBackdrop').hidden = false; }
function closeMobileSidebar(){ $('sidebar').classList.remove('mobile-open'); $('mobileBackdrop').hidden = true; }
function toggleMobileSidebar(){ if ($('sidebar').classList.contains('mobile-open')) closeMobileSidebar(); else openMobileSidebar(); }

function parseFrontmatter(raw){
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if(!m) return {meta:{}, content:raw};
  const meta={};
  m[1].split('\n').forEach(line=>{
    const [k,...rest]=line.split(':'); if(!k) return;
    let val = rest.join(':').trim();
    if(val.startsWith('[')&&val.endsWith(']')) val = val.slice(1,-1).split(',').map(s=>s.trim().replace(/^["']|["']$/g,'')).filter(Boolean);
    else val = val.replace(/^["']|["']$/g,'');
    meta[k.trim()] = val;
  });
  return {meta, content:m[2]};
}

function buildFrontmatter(meta, content){
  const lines = Object.entries(meta).map(([k,v]) => Array.isArray(v) ? `${k}: [${v.map(s=>`"${s}"`).join(', ')}]` : `${k}: "${v}"`);
  return `---\n${lines.join('\n')}\n---\n\n${content}`;
}

function extractWikiLinks(content=''){
  const re=/\[\[([^\]]+)\]\]/g, links=[]; let m;
  while((m=re.exec(content))!==null) links.push(m[1].trim());
  return [...new Set(links)];
}

function renderWikiLinks(content=''){
  return content.replace(/\[\[([^\]]+)\]\]/g, (_,title)=>{
    const target=state.cards.find(c=>c.title.toLowerCase()===title.toLowerCase());
    return `<a href="#" class="${target?'wikilink':'wikilink broken'}" data-target-id="${target?target.id:''}" data-target-title="${escHtml(title)}">${escHtml(title)}</a>`;
  });
}

async function openFolder(){
  if(!('showDirectoryPicker' in window)){ showToast('Use Chrome or Edge desktop for folder access.', 3500); return; }
  try{
    state.dirHandle = await window.showDirectoryPicker({mode:'readwrite'});
    $('folderPath').textContent = state.dirHandle.name;
    await loadAllFiles();
    showToast(`Opened: ${state.dirHandle.name}`);
  }catch(e){ if(e.name!=='AbortError') showToast('Could not open folder'); }
}

async function loadAllFiles(){
  if(!state.dirHandle) return;
  state.cards=[];
  for await (const [name, handle] of state.dirHandle.entries()){
    if(handle.kind!=='file' || !name.endsWith('.md')) continue;
    const file = await handle.getFile();
    const raw = await file.text();
    const {meta, content} = parseFrontmatter(raw);
    state.cards.push({
      id: meta.id || name.replace('.md',''),
      filename: name,
      fileHandle: handle,
      title: meta.title || name.replace('.md',''),
      type: meta.type || 'permanent',
      tags: Array.isArray(meta.tags)?meta.tags:(meta.tags?[meta.tags]:[]),
      source: meta.source || '',
      content,
      links: extractWikiLinks(content),
      backlinks: [],
      modified: new Date(file.lastModified).toISOString()
    });
  }
  buildBacklinks();
  renderAll();
}

function buildBacklinks(){
  state.cards.forEach(c=>c.backlinks=[]);
  state.cards.forEach(card=>card.links.forEach(linkTitle=>{
    const target = state.cards.find(c=>c.title.toLowerCase()===linkTitle.toLowerCase());
    if(target && !target.backlinks.includes(card.title)) target.backlinks.push(card.title);
  }));
}

async function saveCardToFile(card){
  if(!state.dirHandle){ showToast('No folder open. Card exists in memory only.'); return; }
  const meta = { id: card.id, title: card.title, type: card.type, tags: card.tags, modified: new Date().toISOString() };
  if(card.source) meta.source = card.source;
  const raw = buildFrontmatter(meta, card.content);
  if(!card.fileHandle){
    card.filename = card.filename || `${card.id}-${card.title.replace(/[^a-z0-9]/gi,'-').toLowerCase().slice(0,40)}.md`;
    card.fileHandle = await state.dirHandle.getFileHandle(card.filename, {create:true});
  }
  const writable = await card.fileHandle.createWritable();
  await writable.write(raw);
  await writable.close();
  showToast('Card saved ✓');
}

function getFilteredCards(){
  let cards=[...state.cards];
  if(state.activeType!=='all') cards=cards.filter(c=>c.type===state.activeType);
  if(state.activeTag) cards=cards.filter(c=>c.tags.includes(state.activeTag));
  return cards;
}

function renderAll(){ renderCards(); renderTags(); renderRecent(); updateCount(); initFuse(); }
function updateCount(){ $('cardCount').textContent = `${state.cards.length} card${state.cards.length!==1?'s':''}`; }

function createCardEl(card){
  const el=document.createElement('div');
  el.className='card'; el.dataset.type=card.type;
  const tags=card.tags.slice(0,3).map(t=>`<span class="card-tag">${escHtml(t)}</span>`).join('');
  const linksCount=card.links.length+card.backlinks.length;
  el.innerHTML=`<div class="card-header"><span class="card-title">${escHtml(card.title)}</span><span class="card-type-dot"></span></div><p class="card-excerpt">${escHtml(card.content.slice(0,180).replace(/[#*_`\[\]]/g,''))}</p><div class="card-footer"><div class="card-tags">${tags}</div><div style="display:flex;align-items:center;gap:var(--space-3)">${linksCount?`<span class="card-links-count"><i data-lucide="link-2" style="width:11px;height:11px"></i>${linksCount}</span>`:''}<span class="card-date">${formatDate(card.modified)}</span></div></div>`;
  el.addEventListener('click',()=>openReader(card.id));
  return el;
}

function renderCards(){
  const grid=$('cardsGrid'), empty=$('emptyState');
  const cards=getFilteredCards().sort((a,b)=>(b.modified||'').localeCompare(a.modified||''));
  grid.innerHTML='';
  if(!cards.length){ empty.classList.add('visible'); return; }
  empty.classList.remove('visible');
  cards.forEach(c=>grid.appendChild(createCardEl(c)));
  lucide.createIcons();
}

function renderTags(){
  const list=$('tagList'); list.innerHTML='';
  const map={}; state.cards.forEach(c=>c.tags.forEach(t=>map[t]=(map[t]||0)+1));
  Object.entries(map).sort().forEach(([tag,count])=>{
    const el=document.createElement('div');
    el.className='tag-list-item'+(state.activeTag===tag?' active':'');
    el.innerHTML=`<span>${escHtml(tag)}</span><span class="tag-count">${count}</span>`;
    el.addEventListener('click',()=>{ state.activeTag = state.activeTag===tag?null:tag; renderAll(); if(isMobile()) closeMobileSidebar(); });
    list.appendChild(el);
  });
}

function openReader(id){
  const card=state.cards.find(c=>c.id===id); if(!card) return;
  state.readerCard=card;
  state.recentIds=[id,...state.recentIds.filter(x=>x!==id)].slice(0,20);
  $('readerTitle').textContent=card.title;
  $('readerType').textContent=card.type; $('readerType').className=`type-badge ${card.type}`;
  const meta=$('readerMeta'); meta.innerHTML='';
  card.tags.forEach(t=>{ const chip=document.createElement('span'); chip.className='tag-chip'; chip.textContent=t; meta.appendChild(chip); });
  if(card.source){ const s=document.createElement('span'); s.style.cssText='font-size:var(--text-xs);color:var(--color-text-faint)'; s.textContent=card.source; meta.appendChild(s); }
  $('readerContent').innerHTML=marked.parse(renderWikiLinks(card.content));
  $('readerContent').querySelectorAll('.wikilink').forEach(a=>a.addEventListener('click',e=>{ e.preventDefault(); if(a.dataset.targetId) openReader(a.dataset.targetId); else showToast(`"${a.dataset.targetTitle}" not found`); }));
  renderReaderLinks(card);
  $('readerOverlay').classList.add('open');
  lucide.createIcons();
}

function renderReaderLinks(card){
  const out=$('readerOutgoing'), back=$('readerBacklinks'); out.innerHTML=''; back.innerHTML='';
  const mk = (title,type,targetId) => { const el=document.createElement('div'); el.className='link-item'; el.innerHTML=`<span class="link-item-dot" style="background:var(--color-${type||'text-faint'})"></span><span>${escHtml(title)}</span>`; if(targetId) el.addEventListener('click',()=>openReader(targetId)); return el; };
  if(card.links.length===0) out.innerHTML='<span class="no-links">No outgoing links</span>'; else card.links.forEach(title=>{ const t=state.cards.find(c=>c.title.toLowerCase()===title.toLowerCase()); out.appendChild(mk(title,t?.type,t?.id)); });
  if(card.backlinks.length===0) back.innerHTML='<span class="no-links">No backlinks yet</span>'; else card.backlinks.forEach(title=>{ const t=state.cards.find(c=>c.title.toLowerCase()===title.toLowerCase()); back.appendChild(mk(title,t?.type,t?.id)); });
}

function closeReader(){ $('readerOverlay').classList.remove('open'); }

function openEditor(card=null){
  state.editingCard=card;
  $('editorTitle').textContent = card?'Edit Card':'New Card';
  $('editorCardTitle').value = card?card.title:'';
  $('editorType').value = card?card.type:'permanent';
  $('editorTags').value = card?card.tags.join(', '):'';
  $('editorSource').value = card?card.source:'';
  $('editorContent').value = card?card.content:'';
  switchEditorTab('write');
  $('editorOverlay').classList.add('open');
}
function closeEditor(){ $('editorOverlay').classList.remove('open'); }
function switchEditorTab(tab){ $$('.editor-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab)); $$('.editor-tab-content').forEach(c=>c.classList.toggle('active',c.id===`tab-${tab}`)); if(tab==='preview') $('editorPreview').innerHTML=marked.parse(renderWikiLinks($('editorContent').value)); if(tab==='links') updateEditorLinks(); }
function updateEditorLinks(){ const links=extractWikiLinks($('editorContent').value); $('outgoingLinks').innerHTML=links.length?links.map(l=>`<div class="link-item"><span>${escHtml(l)}</span></div>`).join(''):'<span class="no-links">No [[wikilinks]] in this card yet</span>'; $('backlinks').innerHTML=state.editingCard?.backlinks?.length?state.editingCard.backlinks.map(l=>`<div class="link-item"><span>${escHtml(l)}</span></div>`).join(''):'<span class="no-links">No backlinks yet</span>'; }

async function saveCard(){
  const title=$('editorCardTitle').value.trim(); if(!title){ showToast('Please enter a title'); return; }
  const card = state.editingCard || { id: generateId(), filename:'', fileHandle:null, backlinks:[] };
  card.title=title; card.type=$('editorType').value; card.tags=$('editorTags').value.split(',').map(t=>t.trim()).filter(Boolean); card.source=$('editorSource').value.trim(); card.content=$('editorContent').value; card.links=extractWikiLinks(card.content); card.modified=new Date().toISOString();
  if(!state.editingCard) state.cards.push(card);
  buildBacklinks();
  await saveCardToFile(card);
  renderAll();
  closeEditor();
}

function renderGraph(){
  const container=$('graphContainer'); container.innerHTML='';
  if(!state.cards.length){ container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-text-faint)">No cards to display</div>'; return; }
  const w=container.clientWidth||800,h=container.clientHeight||500;
  const css=getComputedStyle(document.documentElement);
  const nodes=state.cards.map(c=>({id:c.id,title:c.title,type:c.type,connections:c.links.length+c.backlinks.length}));
  const links=[]; state.cards.forEach(card=>card.links.forEach(t=>{ const target=state.cards.find(c=>c.title.toLowerCase()===t.toLowerCase()); if(target) links.push({source:card.id,target:target.id}); }));
  const svg=d3.select(container).append('svg').attr('width',w).attr('height',h);
  const simulation=d3.forceSimulation(nodes).force('link',d3.forceLink(links).id(d=>d.id).distance(80)).force('charge',d3.forceManyBody().strength(-200)).force('center',d3.forceCenter(w/2,h/2)).force('collision',d3.forceCollide().radius(30));
  const link=svg.append('g').selectAll('line').data(links).join('line').attr('class','graph-link').attr('stroke',css.getPropertyValue('--color-border').trim());
  const node=svg.append('g').selectAll('g').data(nodes).join('g').attr('class','graph-node').on('click',(_,d)=>openReader(d.id));
  node.append('circle').attr('r',d=>Math.min(8+d.connections*2,20)).attr('fill',d=>css.getPropertyValue(`--color-${d.type}`).trim()||css.getPropertyValue('--color-permanent').trim()).attr('fill-opacity',0.85);
  node.append('text').attr('dy',24).attr('text-anchor','middle').text(d=>d.title.length>20?d.title.slice(0,18)+'…':d.title).attr('fill',css.getPropertyValue('--color-text-muted').trim());
  simulation.on('tick',()=>{ link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y); node.attr('transform',d=>`translate(${d.x},${d.y})`); });
}

function renderRecent(){ const grid=$('recentGrid'); grid.innerHTML=''; const recent=state.recentIds.map(id=>state.cards.find(c=>c.id===id)).filter(Boolean); if(!recent.length){ grid.innerHTML='<div class="search-empty">No recently viewed cards yet.</div>'; return; } recent.forEach(c=>grid.appendChild(createCardEl(c))); lucide.createIcons(); }

let fuseInstance=null;
function initFuse(){ fuseInstance=new Fuse(state.cards,{keys:['title','content','tags','source'],threshold:0.35,minMatchCharLength:2}); }
function doSearch(query, container){ if(!query.trim()){ container.innerHTML='<div class="search-empty">Type to search...</div>'; return; } const results=fuseInstance.search(query).slice(0,30); container.innerHTML=''; if(!results.length){ container.innerHTML=`<div class="search-empty">No results for "${escHtml(query)}"</div>`; return; } results.forEach(({item})=>{ const el=document.createElement('div'); el.className='search-result'; el.innerHTML=`<div class="search-result-title">${escHtml(item.title)}</div><div class="search-result-excerpt">${escHtml(item.content.slice(0,200).replace(/[#*_`\[\]]/g,''))}…</div>`; el.addEventListener('click',()=>openReader(item.id)); container.appendChild(el); }); }

function switchView(view){ state.currentView=view; $$('.view').forEach(v=>v.classList.remove('active')); $(`view-${view}`).classList.add('active'); $$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); if(view==='graph') renderGraph(); if(view==='recent') renderRecent(); if(isMobile()) closeMobileSidebar(); }
function toggleTheme(){ state.currentTheme = state.currentTheme==='dark'?'light':'dark'; document.documentElement.setAttribute('data-theme', state.currentTheme); }

function loadDemoCards(){
  state.cards=[
    {id:'20260406-0001',filename:'demo-fatigue.md',fileHandle:null,title:'Fatigue Degrades Metacognition Before Performance',type:'permanent',tags:['fatigue','aviation-safety','cognition'],source:'Caldwell et al., 2009',content:'Pilots experiencing acute sleep deprivation lose the ability to accurately assess their own impairment before objective task performance measurably degrades.\n\nSee [[KSS Scale Calibration Issues]] and [[FAR 117 Rest Requirements]].',links:['KSS Scale Calibration Issues','FAR 117 Rest Requirements'],backlinks:[],modified:new Date().toISOString()},
    {id:'20260406-0002',filename:'demo-far117.md',fileHandle:null,title:'FAR 117 Rest Requirements',type:'literature',tags:['regulations','FAR-117','rest'],source:'FAA FAR Part 117',content:'FAR 117 governs flight and duty time limitations for Part 121 air carriers.\n\nSee [[Fatigue Degrades Metacognition Before Performance]].',links:['Fatigue Degrades Metacognition Before Performance'],backlinks:[],modified:new Date().toISOString()},
    {id:'20260406-0003',filename:'demo-kss.md',fileHandle:null,title:'KSS Scale Calibration Issues',type:'literature',tags:['fatigue','measurement','KSS'],source:'Åkerstedt & Gillberg, 1990',content:'The Karolinska Sleepiness Scale (KSS) is a 9-point self-report scale measuring subjective sleepiness.\n\nSee [[Fatigue Degrades Metacognition Before Performance]].',links:['Fatigue Degrades Metacognition Before Performance'],backlinks:[],modified:new Date().toISOString()}
  ];
  buildBacklinks(); renderAll();
}

document.addEventListener('DOMContentLoaded', ()=>{
  lucide.createIcons();
  loadDemoCards();

  $('mobileSidebarToggle').addEventListener('click', toggleMobileSidebar);
  $('mobileBackdrop').addEventListener('click', closeMobileSidebar);
  $('sidebarToggle').addEventListener('click', ()=> $('sidebar').classList.toggle('collapsed'));

  $$('.nav-item[data-view]').forEach(btn=>btn.addEventListener('click', ()=>switchView(btn.dataset.view)));
  $$('.tag-chip[data-type]').forEach(chip=>chip.addEventListener('click', ()=>{ $$('.tag-chip[data-type]').forEach(c=>c.classList.remove('active')); chip.classList.add('active'); state.activeType=chip.dataset.type; renderCards(); if(isMobile()) closeMobileSidebar(); }));

  $('newCardBtn').addEventListener('click', ()=>{ openEditor(); if(isMobile()) closeMobileSidebar(); });
  [$('openFolderBtn'),$('emptyOpenBtn'),$('settingsOpenBtn')].forEach(btn=>btn?.addEventListener('click', async()=>{ if(isMobile()) closeMobileSidebar(); await openFolder(); }));
  $('refreshBtn').addEventListener('click', ()=>loadAllFiles());
  $('themeToggle').addEventListener('click', toggleTheme);

  $('gridViewBtn').addEventListener('click', ()=>{ $('cardsGrid').classList.remove('list-view'); $('gridViewBtn').classList.add('active'); $('listViewBtn').classList.remove('active'); });
  $('listViewBtn').addEventListener('click', ()=>{ $('cardsGrid').classList.add('list-view'); $('listViewBtn').classList.add('active'); $('gridViewBtn').classList.remove('active'); });

  $('quickSearch').addEventListener('input', e=>{ if(e.target.value.trim().length>1){ switchView('search'); $('fullSearch').value=e.target.value; doSearch(e.target.value, $('searchResults')); } });
  $('fullSearch').addEventListener('input', e=>doSearch(e.target.value, $('searchResults')));

  $('closeEditor').addEventListener('click', closeEditor);
  $('saveCard').addEventListener('click', saveCard);
  $$('.editor-tab').forEach(tab=>tab.addEventListener('click', ()=>switchEditorTab(tab.dataset.tab)));
  $('closeReader').addEventListener('click', closeReader);
  $('editFromReader').addEventListener('click', ()=>{ const c=state.readerCard; closeReader(); openEditor(c); });
  $('editorOverlay').addEventListener('click', e=>{ if(e.target===$('editorOverlay')) closeEditor(); });
  $('readerOverlay').addEventListener('click', e=>{ if(e.target===$('readerOverlay')) closeReader(); });
  $('cmdPalette').addEventListener('click', e=>{ if(e.target===$('cmdPalette')) $('cmdPalette').classList.remove('open'); });

  document.addEventListener('keydown', e=>{
    const inInput=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){ e.preventDefault(); $('cmdPalette').classList.add('open'); $('cmdInput').focus(); }
    if((e.ctrlKey||e.metaKey)&&e.key==='n'){ e.preventDefault(); openEditor(); }
    if((e.ctrlKey||e.metaKey)&&e.key==='s'&&$('editorOverlay').classList.contains('open')){ e.preventDefault(); saveCard(); }
    if(e.key==='Escape'){ if($('cmdPalette').classList.contains('open')) $('cmdPalette').classList.remove('open'); else if($('editorOverlay').classList.contains('open')) closeEditor(); else if($('readerOverlay').classList.contains('open')) closeReader(); else if(isMobile() && $('sidebar').classList.contains('mobile-open')) closeMobileSidebar(); }
    if(e.key==='?'&&!inInput) switchView('settings');
  });

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; $('installBtn').style.display='flex'; $('installHint').style.display='none'; });
  $('installBtn').addEventListener('click', async()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; });

  if('serviceWorker' in navigator){
    window.addEventListener('load', async()=>{
      const candidates=['./sw.js','sw.js','/sw.js'];
      for(const candidate of candidates){
        try{
          const swUrl=new URL(candidate, window.location.href);
          const res=await fetch(swUrl.href,{method:'GET',cache:'no-store'});
          if(res.ok){
            await navigator.serviceWorker.register(swUrl.href,{scope:'./'});
            console.log('SW registered:', swUrl.href);
            break;
          }
        }catch(err){ console.warn('SW candidate failed:', candidate, err); }
      }
    });
  }

  window.addEventListener('resize', ()=>{ if(!isMobile()) closeMobileSidebar(); });
});
