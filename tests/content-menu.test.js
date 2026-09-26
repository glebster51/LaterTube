const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const hiddenPopup = { offsetParent: null };
const visiblePopup = { offsetParent: {} };
let desktopSelector = "";

const document = {
  documentElement: {},
  addEventListener() {},
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === "yt-sheet-view-model") return [];
    if (selector.includes("ytd-menu-popup-renderer")) {
      desktopSelector = selector;
      return [hiddenPopup, visiblePopup];
    }
    return [];
  }
};

class MutationObserver {
  observe() {}
  disconnect() {}
}

const context = vm.createContext({
  chrome: {
    i18n: { getMessage: key => key },
    runtime: { id: "test", async sendMessage() { return null; } }
  },
  clearTimeout,
  console,
  document,
  HTMLButtonElement: class {},
  location: { href: "https://www.youtube.com/" },
  MutationObserver,
  setTimeout,
  URL
});

vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"),
  context,
  { filename: "content.js" }
);

assert.equal(context.findVisibleDesktopMenuList(), visiblePopup);
assert.match(desktopSelector, /ytd-menu-popup-renderer tp-yt-paper-listbox/);
assert.match(desktopSelector, /ytd-menu-popup-renderer #items/);
assert.match(desktopSelector, /ytd-menu-popup tp-yt-paper-listbox/);
assert.match(desktopSelector, /ytd-menu-popup #items/);

console.log("content menu tests passed");
