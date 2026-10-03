// Adds a "Frame" button to each comment on new Reddit and gathers the data to render.

const MARK = 'data-rsnap';
let lastContextComment = null;

// Find the shreddit-comment an event came from, across shadow roots.
function commentFromEvent(e) {
  return e.composedPath().find((n) => n.tagName === 'SHREDDIT-COMMENT') || null;
}

function addButton(comment) {
  if (comment.hasAttribute(MARK)) return;
  comment.setAttribute(MARK, '');
  // Sharing the action row's slot makes the button render inside the comment's own layout.
  const row = comment.querySelector(':scope > shreddit-comment-action-row');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rsnap-btn';
  btn.textContent = '🖼 Frame';
  btn.title = 'Make a shareable image of the post + this comment';
  btn.slot = row?.getAttribute('slot') || 'actionRow';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    frameComment(comment, btn);
  });
  (row ? row.after(btn) : comment.append(btn));
}

function scan(root = document) {
  root.querySelectorAll(`shreddit-comment:not([${MARK}])`).forEach(addButton);
}

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

// Depth-first path from a listing down to the target comment id.
function findPath(children, targetId) {
  for (const c of children || []) {
    if (c.kind !== 't1') continue;
    if (c.data.id === targetId) return [c.data];
    const sub = findPath(c.data.replies?.data?.children, targetId);
    if (sub) return [c.data, ...sub];
  }
  return null;
}

async function avatarFor(name) {
  if (!name || name === '[deleted]') return null;
  try {
    const { data } = await getJSON(`/user/${encodeURIComponent(name)}/about.json?raw_json=1`);
    return (data.snoovatar_img || data.icon_img || '').split('?')[0] || null;
  } catch {
    return null;
  }
}

async function subIcon(sub) {
  try {
    const { data } = await getJSON(`/r/${encodeURIComponent(sub)}/about.json?raw_json=1`);
    return data.community_icon || data.icon_img || null;
  } catch {
    return null;
  }
}

async function frameComment(comment, btn) {
  const commentId = (comment.getAttribute('thingid') || '').replace(/^t1_/, '');
  const postId = (comment.getAttribute('postid')
    || document.querySelector('shreddit-post')?.id || '').replace(/^t3_/, '');
  if (!commentId || !postId) return alert('Reddit Snap: could not identify this comment.');

  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Framing…'; }
  try {
    const [postListing, commentListing] = await getJSON(
      `/comments/${postId}/_/${commentId}.json?context=8&raw_json=1`
    );
    const post = postListing.data.children[0].data;
    const chain = findPath(commentListing.data.children, commentId);
    if (!chain) throw new Error('comment not found in thread');

    const target = chain[chain.length - 1];
    const replies = (target.replies?.data?.children || [])
      .filter((c) => c.kind === 't1').map((c) => c.data);

    const names = [...new Set([...chain, ...replies].map((c) => c.author))];
    const [icons, sub] = await Promise.all([
      Promise.all(names.map(avatarFor)),
      subIcon(post.subreddit),
    ]);
    const avatars = Object.fromEntries(names.map((n, i) => [n, icons[i]]));

    // Drop nested replies so the payload stays small.
    const strip = (c) => ({ ...c, replies: undefined });
    await chrome.runtime.sendMessage({
      type: 'open-frame',
      payload: {
        post, subIcon: sub, avatars,
        chain: chain.map(strip), replies: replies.map(strip),
      },
    });
  } catch (err) {
    console.error('[reddit-snap]', err);
    alert(`Reddit Snap failed: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// Right-click fallback, in case Reddit's markup hides the button.
document.addEventListener('contextmenu', (e) => { lastContextComment = commentFromEvent(e); }, true);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'frame-last-target') return;
  if (lastContextComment) frameComment(lastContextComment, null);
  else alert('Reddit Snap: right-click on a comment to frame it.');
});

scan();
new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'SHREDDIT-COMMENT') addButton(n);
      scan(n);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
