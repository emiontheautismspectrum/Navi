// Render both screens in all languages and both themes.
// Any unhandled error means a white screen for the user.
import { renderToString } from "react-dom/server";
import React from "react";
import Landing from "./src/Landing.jsx";
import Chat from "./src/Chat.jsx";

// stubs for browser APIs that do not exist in Node
global.window = { innerWidth: 1400, addEventListener(){}, removeEventListener(){} };
global.localStorage = { getItem: () => null, setItem(){} };
global.location = { hash: "" };
global.document = { documentElement: {}, body: {} };
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });

const noop = () => {};

// useLayoutEffect does nothing in server rendering. In reality the app
// renders only in the browser, so this is harness noise, not an error.
// Silenced so it does not mask real problems.
const warn = console.error;
console.error = (...a) =>
  String(a[0]).includes("useLayoutEffect does nothing on the server") ? undefined : warn(...a);
let fails = 0;

for (const lang of ["ru", "en", "uz"]) {
  for (const theme of ["dark", "light"]) {
    for (const [name, C, props] of [
      ["Landing", Landing, { lang, setLang: noop, theme, setTheme: noop, onEnter: noop }],
      ["Chat", Chat, { lang, setLang: noop, theme, setTheme: noop, onHome: noop }],
    ]) {
      try {
        const html = renderToString(React.createElement(C, props));
        if (!html || html.length < 200) throw new Error("suspiciously empty output");
        console.log(`  OK  ${name} · ${lang} · ${theme} (${html.length} chars)`);
      } catch (e) {
        fails++;
        console.log(`  FAIL ${name} · ${lang} · ${theme}: ${e.message}`);
      }
    }
  }
}
console.log(fails === 0 ? "\nALL COMBINATIONS RENDER" : `\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
