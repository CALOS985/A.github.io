/* ==================== 恢复原 Live2D：组件来自 CALOS985/F.github.io ====================
 * 沿用该仓库 autoload.js 的资源与 initWidget 配置，使用受控加载和错误提示。
 * 默认模型为用户截图中的叢雲；保留已有角色、换装和关闭偏好。
 * 不重复引入原来右侧的另一套 L2Dwidget，不启用会修改资源页面的飞船小游戏。
 */
(() => {
  "use strict";
  const root = "https://calos985.github.io/F.github.io/";
  const cdn = "https://fastly.jsdelivr.net/gh/fghrsh/live2d_api/";
  const desktop = matchMedia("(min-width: 768px)");
  const status = document.getElementById("live2d-status");
  const retry = document.getElementById("live2d-retry");
  const pending = new Map();
  let loading = false;
  let initialized = false;
  let observer;

  /* 异步脚本／样式失败可重试；任何故障只影响看板娘，不阻断主界面。 */
  function loadResource(url, type) {
    if (pending.has(url)) return pending.get(url);
    const task = new Promise((resolve, reject) => {
      const element = document.createElement(
        type === "css" ? "link" : "script",
      );
      if (type === "css") {
        element.rel = "stylesheet";
        element.href = url;
      } else {
        element.src = url;
        element.async = true;
      }
      const timer = setTimeout(() => fail(), 15000);
      function fail() {
        clearTimeout(timer);
        element.remove();
        reject(new Error("Live2D 资源暂不可用"));
      }
      element.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      element.onerror = fail;
      document.head.append(element);
    }).catch((error) => {
      pending.delete(url);
      throw error;
    });
    pending.set(url, task);
    return task;
  }
  async function checkJSON(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Live2D 配置暂不可用");
    return response.json();
  }

  /* 原组件工具使用 span/div；补上键盘操作与中文名称，不改变原来的点击逻辑。 */
  function enhanceControls() {
    const names = {
      hitokoto: "听一句一言",
      "switch-model": "切换看板娘角色",
      "switch-texture": "切换看板娘服装",
      photo: "保存看板娘照片",
      info: "查看看板娘组件信息",
      quit: "关闭看板娘",
    };
    for (const [tool, name] of Object.entries(names)) {
      const control = document.getElementById("waifu-tool-" + tool);
      if (control) makeButton(control, name);
    }
    const toggle = document.getElementById("waifu-toggle");
    if (toggle) makeButton(toggle, "重新显示看板娘");
  }
  function makeButton(element, name) {
    if (element.dataset.calosEnhanced) return;
    element.dataset.calosEnhanced = "true";
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", name);
    element.title = name;
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        element.click();
      }
    });
  }
  function syncDock() {
    const widget = document.getElementById("waifu");
    const visible =
      desktop.matches &&
      !!widget &&
      getComputedStyle(widget).display !== "none";
    document.body.classList.toggle("live2d-visible", visible);
    enhanceControls();
  }

  /* 看板娘延后初始化；先核对远端配置，避免原组件加载失败产生未处理的 Promise。 */
  async function initialize() {
    if (!desktop.matches || loading || initialized) return;
    loading = true;
    status.hidden = true;
    retry.disabled = true;
    try {
      const [models] = await Promise.all([
        checkJSON(cdn + "model_list.json"),
        checkJSON(root + "waifu-tips.json"),
        loadResource(root + "waifu.css", "css"),
        loadResource(root + "live2d.min.js", "js"),
        loadResource(root + "waifu-tips.js", "js"),
      ]);
      if (
        !Array.isArray(models.models) ||
        typeof window.initWidget !== "function" ||
        typeof window.loadlive2d !== "function"
      ) {
        throw new Error("Live2D 组件尚未就绪");
      }
      const saved = localStorage.getItem("modelId");
      const id = saved === null ? -1 : Number(saved);
      if (!Number.isInteger(id) || id < 0 || id >= models.models.length) {
        const murakumo = models.models.findIndex(
          (model) => model === "KantaiCollection/murakumo",
        );
        localStorage.setItem("modelId", String(murakumo >= 0 ? murakumo : 1));
        localStorage.setItem("modelTexturesId", "0");
      }
      window.initWidget({
        waifuPath: root + "waifu-tips.json",
        cdnPath: cdn,
        tools: [
          "hitokoto",
          "switch-model",
          "switch-texture",
          "photo",
          "info",
          "quit",
        ],
      });
      initialized = true;
      observer = new MutationObserver(syncDock);
      observer.observe(document.body, { childList: true });
      const widget = document.getElementById("waifu");
      if (widget)
        observer.observe(widget, {
          attributes: true,
          attributeFilter: ["style", "class"],
        });
      // 原组件可能按上次关闭偏好延迟创建模型，重新显示时再观察其可见性。
      document.getElementById("waifu-toggle")?.addEventListener("click", () => {
        const current = document.getElementById("waifu");
        if (current)
          observer.observe(current, {
            attributes: true,
            attributeFilter: ["style", "class"],
          });
        syncDock();
      });
      syncDock();
    } catch {
      status.hidden = false;
      // 不虚构一个静态人物替代 Live2D；保留重试入口与正常的资源浏览。
    } finally {
      loading = false;
      retry.disabled = false;
    }
  }
  retry.addEventListener("click", initialize);
  desktop.addEventListener("change", () => {
    syncDock();
    if (desktop.matches) initialize();
  });
  // 核心分区先可交互；模型只在桌面宽度下载，与原 autoload.js 一致。
  setTimeout(() => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(initialize, { timeout: 1500 });
    else initialize();
  }, 1200);
})();
