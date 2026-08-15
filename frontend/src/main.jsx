import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./Landing.jsx";
import Chat from "./Chat.jsx";
import "./index.css";

function Root() {
  // Хеш-роутинг: работает на статическом хостинге без серверных правил
  const [route, setRoute] = useState(() => (location.hash === "#/app" ? "app" : "landing"));
  const [lang, setLang] = useState("ru");
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const onHash = () => setRoute(location.hash === "#/app" ? "app" : "landing");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [lang, theme]);

  // Запуск системы: круг расходится из точки логотипа и накрывает
  // экран, под ним подменяется маршрут — переход выглядит как
  // раскрытие системы из самого знака.
  const [burst, setBurst] = useState(null);

  const go = (r) => { location.hash = r === "app" ? "#/app" : "#/"; setRoute(r); };

  function launch(origin) {
    if (!origin) { go("app"); return; }
    const { x, y } = origin;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    setBurst({ x, y, r });
    setTimeout(() => go("app"), 380);   // маршрут меняется под накрытым экраном
    setTimeout(() => setBurst(null), 900);
  }

  const shared = { lang, setLang, theme, setTheme };

  return (
    <div data-theme={theme} data-agent="student" style={{ height: "100%" }}>
      <div className="bg" />
      <div className="grain" />
      {route === "app"
        ? <Chat {...shared} onHome={() => go("landing")} />
        : <Landing {...shared} onEnter={launch} />}

      {burst && (
        <span className="burst" style={{
          left: burst.x - burst.r, top: burst.y - burst.r,
          width: burst.r * 2, height: burst.r * 2,
        }} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<StrictMode><Root /></StrictMode>);
