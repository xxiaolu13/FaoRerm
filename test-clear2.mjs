import { createRequire } from "module";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!DOCTYPE html><div id="t" style="width:800px;height:600px"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.self = global;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.OffscreenCanvas = class {};
dom.window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false;} });

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/xterm");

const t = new Terminal({ scrollback: 1000, allowProposedApi: true, cols: 80, rows: 24 });
t.open(dom.window.document.getElementById("t"));

// 模拟 ip a 的长输出（50行）
for (let i = 0; i < 50; i++) {
  t.write(`line ${i + 1}: this is a long line of network interface info\r\n`);
}
t.write("prompt $ ");

console.log("=== 清屏前 ===");
console.log("buffer.length:", t.buffer.active.length);
console.log("buffer.baseY:", t.buffer.active.baseY);
console.log("buffer.viewportY:", t.buffer.active.viewportY);

// 关键测试1：不预处理（原始 xterm 行为）
console.log("\n=== 测试1: 原始 \\x1b[H\\x1b[2J（xterm 默认）===");
t.write("\x1b[H\x1b[2J");
console.log("after 2J - baseY:", t.buffer.active.baseY, "length:", t.buffer.active.length);
t.scrollToTop();
const top1 = t.buffer.active.getLine(0);
console.log("top line:", top1 ? JSON.stringify(top1.translateToString(true)) : "(null)");

// 重置
t.reset();
for (let i = 0; i < 50; i++) {
  t.write(`line ${i + 1}: this is a long line of network interface info\r\n`);
}
t.write("prompt $ ");

// 关键测试2：预处理（我们的方案 - 替换为 \x1b[<rows>S）
console.log("\n=== 测试2: 替换 \\x1b[2J → \\x1b[24S（Scroll Up）===");
const input = "\x1b[H\x1b[2J";
const processed = input.replace(/\x1b\[2J/g, `\x1b[${t.rows}S`);
console.log("input bytes:", JSON.stringify(input), "→ processed:", JSON.stringify(processed));
t.write(processed);
console.log("after 24S - baseY:", t.buffer.active.baseY, "length:", t.buffer.active.length);
t.scrollToTop();
const top2 = t.buffer.active.getLine(0);
console.log("top line:", top2 ? JSON.stringify(top2.translateToString(true)) : "(null)");

// 验证 scrollback 里有几行
let scrollbackCount = 0;
for (let i = 0; i < t.buffer.active.baseY; i++) {
  const line = t.buffer.active.getLine(i);
  if (line && line.translateToString(true).trim()) scrollbackCount++;
}
console.log("scrollback 有内容的行数:", scrollbackCount, "(预期: 50)");

// 测试3：验证 \x1b[3J 被删除
console.log("\n=== 测试3: \\x1b[3J 删除验证 ===");
const before3J = t.buffer.active.baseY;
const input3J = "\x1b[3J";
const processed3J = input3J.replace(/\x1b\[3J/g, "");
console.log("input:", JSON.stringify(input3J), "→ processed:", JSON.stringify(processed3J), "(空=已删除)");
t.write(processed3J);
console.log("baseY before:", before3J, "after:", t.buffer.active.baseY);
