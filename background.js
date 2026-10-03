// Stores the frame payload and opens the preview tab; also owns the right-click fallback.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'frame-comment',
    title: 'Frame this comment',
    contexts: ['all'],
    documentUrlPatterns: ['https://www.reddit.com/*'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'frame-comment' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'frame-last-target' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'open-frame') return;
  const key = `frame-${Date.now()}`;
  chrome.storage.session.set({ [key]: msg.payload }).then(() => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`frame.html?key=${key}`),
      index: sender.tab ? sender.tab.index + 1 : undefined,
    });
    sendResponse({ ok: true });
  });
  return true; // async sendResponse
});
