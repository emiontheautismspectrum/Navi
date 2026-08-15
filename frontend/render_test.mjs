// Рендерим оба экрана на всех языках и в обеих темах.
// Любая необработанная ошибка означает белый экран у пользователя.
import { renderToString } from "react-dom/server";
import React from "react";
import Landing from "./src/Landing.jsx";
import Chat from "./src/Chat.jsx";

// заглушки браузерных API, которых нет в Node
global.window = { innerWidth: 1400, addEventListener(){}, removeEventListener(){} };
global.localStorage = { getItem: () => null, setItem(){} };
global.location = { hash: "" };
global.document = { documentElement: {}, body: {} };
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });

const noop = () => {};
let fails = 0;

for (const lang of ["ru", "en", "uz"]) {
  for (const theme of ["dark", "light"]) {
    for (const [name, C, props] of [
      ["Landing", Landing, { lang, setLang: noop, theme, setTheme: noop, onEnter: noop }],
      ["Chat", Chat, { lang, setLang: noop, theme, setTheme: noop, onHome: noop }],
    ]) {
      try {
        const html = renderToString(React.createElement(C, props));
        if (!html || html.length < 200) throw new Error("подозрительно пустой вывод");
        console.log(`  OK  ${name} · ${lang} · ${theme} (${html.length} симв.)`);
      } catch (e) {
        fails++;
        console.log(`  FAIL ${name} · ${lang} · ${theme}: ${e.message}`);
      }
    }
  }
}
console.log(fails === 0 ? "\nВСЕ КОМБИНАЦИИ РЕНДЕРЯТСЯ" : `\nПАДЕНИЙ: ${fails}`);
process.exit(fails ? 1 : 0);
