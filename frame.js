// Renders the post + chosen comment as a card and exports it as PNG.

const $ = (sel) => document.querySelector(sel);
const card = $('#card');
const status = (t) => { $('#status').textContent = t; };

const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#33464c"/>'
  + '<circle cx="20" cy="16" r="7" fill="#8ba2ad"/><ellipse cx="20" cy="33" rx="12" ry="8" fill="#8ba2ad"/></svg>'
);
const IMG_HOSTS = /(^|\.)(redd\.it|redditmedia\.com|redditstatic\.com|reddit\.com)$/;

let data = null;

// --- helpers -------------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
}

function ago(utc) {
  const s = Date.now() / 1000 - utc;
  const steps = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [n, u] of steps) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}

const num = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${n}`);

function safeImg(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && IMG_HOSTS.test(u.hostname) ? u.href : null;
  } catch { return null; }
}

// Pick the post's main image: gallery item, direct image, or preview/thumbnail.
function postImage(p) {
  if (p.is_gallery && p.gallery_data?.items?.length && p.media_metadata) {
    const m = p.media_metadata[p.gallery_data.items[0].media_id];
    if (m?.s) return m.s.u || m.s.gif;
  }
  if (/\.(jpe?g|png|gif|webp)$/i.test(p.url || '')) return p.url;
  return p.preview?.images?.[0]?.source?.url || null;
}

// Whitelist-sanitise Reddit's body_html; inline emotes and comment images.
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'EM', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE',
  'UL', 'OL', 'LI', 'SUP', 'SPAN', 'H1', 'H2', 'H3', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);

function richText(html, media = {}) {
  if (!html) return el('div');
  const resolve = (key) => { const s = media[key]?.s; return s && (s.gif || s.u); };
  // Emotes / giphy show up as ![img](emote|t5_x|123) text in some bodies.
  html = html.replace(/!\[(?:img|gif)\]\(([^)\s]+)\)/g, (m, key) => {
    const src = safeImg(resolve(key) || '');
    return src ? `<img class="emote" src="${src}">` : '';
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === 'IMG') {
        const src = safeImg(child.getAttribute('src') || '');
        if (!src) { child.remove(); continue; }
        const cls = child.className.includes('emote') || /emote/.test(src) ? 'emote' : null;
        child.replaceWith(el('img', { src, class: cls }));
        continue;
      }
      if (tag === 'A') {
        // Image links in comments become inline images; other links become plain text.
        const href = child.getAttribute('href') || '';
        const img = /(preview|i)\.redd\.it\//.test(href) && safeImg(href);
        child.replaceWith(img ? el('img', { src: img }) : el('span', {}, child.textContent));
        continue;
      }
      if (!ALLOWED.has(tag)) { child.replaceWith(...child.childNodes); walk(node); return; }
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      walk(child);
    }
  };
  walk(doc.body);
  const out = el('div');
  out.append(...doc.body.childNodes);
  return out;
}

// Convert every remote <img> in the card to a data URL so export isn't blocked by CORS.
async function inlineImages(root) {
  const cache = new Map();
  const toData = (url) => {
    if (!cache.has(url)) {
      cache.set(url, fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.blob();
      }).then((b) => new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(b);
      })).catch(() => null));
    }
    return cache.get(url);
  };
  await Promise.all([...root.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    const d = await toData(src);
    if (d) img.src = d;
    else if (img.closest('.c-head, .post-head')) img.src = DEFAULT_AVATAR;
    else img.remove();
  }));
  await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
}

// --- render --------------------------------------------------------------

const avatarOf = (name) => safeImg(data.avatars[name] || '') || DEFAULT_AVATAR;
const isOp = (c) => c.author === data.post.author && c.author !== '[deleted]';

// One-line context row for parent comments / replies.
function compactNode(c) {
  const text = new DOMParser().parseFromString(c.body_html || '', 'text/html').body.textContent.trim();
  return el('div', { class: 'ctx' }, el('b', {}, c.author), isOp(c) ? ' (OP)' : '', ': ',
    text.length > 120 ? `${text.slice(0, 117)}…` : text);
}

function render() {
  const { post, chain, replies } = data;
  const showParents = $('#opt-parents').checked;
  const showReplies = $('#opt-replies').checked;
  const showStats = $('#opt-actions').checked;
  const target = chain[chain.length - 1];
  const img = safeImg(postImage(post) || '');

  const head = el('div', { class: 'post-head' },
    el('img', { src: safeImg(data.subIcon || '') || DEFAULT_AVATAR, alt: '' }),
    el('span', {}, el('span', { class: 'sub' }, `r/${post.subreddit}`), ` · u/${post.author}`));

  const media = img
    ? el('img', { class: 'media', src: img, alt: '' })
    : (post.selftext_html ? el('div', { class: 'selftext' }, richText(post.selftext_html, post.media_metadata)) : null);

  const context = showParents && chain.length > 1
    ? el('div', { class: 'context' }, chain.slice(0, -1).map(compactNode))
    : null;

  const reply = el('div', { class: 'reply' },
    el('div', { class: 'who' },
      el('img', { src: avatarOf(target.author), alt: '' }),
      el('b', {}, target.author),
      isOp(target) ? el('span', { class: 'op' }, 'OP') : null,
      el('span', {}, `· ${ago(target.created_utc)}`)),
    el('div', { class: 'quote' }, richText(target.body_html, target.media_metadata)),
    showStats ? el('div', { class: 'votes' }, `▲ ${num(target.score)}`) : null);

  const kids = showReplies && replies.length
    ? el('div', { class: 'replies' }, replies.slice(0, 3).map(compactNode))
    : null;

  const foot = el('div', { class: 'foot' }, el('i'), 'framed with Reddit Snap');

  card.replaceChildren(...[head, el('h1', { class: 'title' }, post.title), media, context, reply, kids, foot]
    .filter(Boolean));
  $('#opt-replies').disabled = !replies.length;
  $('#opt-parents').disabled = chain.length < 2;
}

// 4:5 mode: text steps down until the post image keeps ~40% of the card and nothing overflows.
function fit() {
  if (!card.classList.contains('fixed')) return;
  const quote = card.querySelector('.quote');
  const title = card.querySelector('.title');
  let q = 31, t = 23;
  quote.style.fontSize = `${q}px`; title.style.fontSize = `${t}px`;
  const media = card.querySelector('.media, .selftext');
  const overflowing = () => card.scrollHeight > card.clientHeight + 1
    || (media && media.getBoundingClientRect().height < 260); // keep ~40% of the card for the post
  while (overflowing() && (q > 15 || t > 16)) {
    if (q > 15) quote.style.fontSize = `${(q -= 1)}px`;
    if (t > 16 && q < 24) title.style.fontSize = `${(t -= 1)}px`;
  }
}

async function refresh() {
  $('#download').disabled = $('#copy').disabled = true;
  status('Loading images…');
  card.classList.toggle('fixed', $('#opt-size').value === 'fixed');
  try { localStorage.setItem('rsnap-size', $('#opt-size').value); } catch {}
  render();
  await inlineImages(card);
  await document.fonts.ready;
  fit();
  status('');
  $('#download').disabled = $('#copy').disabled = false;
}

async function toBlob() {
  // 540px card at 2x → 1080px wide (1080x1350 in 4:5 mode).
  return htmlToImage.toBlob(card, { pixelRatio: 2, cacheBust: false });
}

// --- boot ----------------------------------------------------------------

async function main() {
  const key = new URLSearchParams(location.search).get('key');
  data = key && (await chrome.storage.session.get(key))[key];
  if (!data) {
    card.replaceChildren(el('p', { class: 'err' }, 'Nothing to frame. Click "Frame" on a Reddit comment.'));
    return;
  }
  document.title = `Frame – ${data.post.title}`;
  try { $('#opt-size').value = localStorage.getItem('rsnap-size') || 'full'; } catch {}
  for (const id of ['#opt-size', '#opt-parents', '#opt-replies', '#opt-actions']) $(id).addEventListener('change', refresh);

  $('#download').addEventListener('click', async () => {
    status('Rendering…');
    const blob = await toBlob();
    const a = el('a', {
      href: URL.createObjectURL(blob),
      download: `reddit-${data.post.subreddit}-${data.chain.at(-1).id}.png`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    status('Saved.');
  });

  $('#copy').addEventListener('click', async () => {
    status('Rendering…');
    try {
      // Pass the promise so the clipboard keeps the user-gesture activation.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob() })]);
      status('Copied!');
    } catch (e) {
      status(`Copy failed: ${e.message}`);
    }
  });

  await refresh();
}

main();
