/* ==================== 数据、分区与浏览状态 ==================== */
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const store = {
    get(key, fallback) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* 私密模式也可以正常浏览 */
      }
    },
  };
  const tools = [
    [
      "MUGEN新手村",
      "新手入门",
      "https://www.yuque.com/kaluoyanjiusuo/gwrf70/ny150b?",
    ],
    [
      "MUGEN1.1教学",
      "新手入门",
      "https://calos985.github.io/E.github.io/MUGEN%201.1.html",
    ],
    ["MUGEN整合", "整合资源", "https://space.bilibili.com/39639621"],
    [
      "MUGEN人物",
      "人物资源",
      "https://mugenarchive.com/forums/downloads.php?do=cat&id=1-characters",
    ],
    ["MUGEN辅助工具", "辅助工具", "https://qxmugen.com/resource/tools"],
    ["MUGEN外网站点", "相关站点", "https://qxmugen.com/links"],
  ].map(([title, category, url], i) => ({
    id: "mugen-" + i,
    title,
    category,
    url,
    section: "mugen",
    public: true,
  }));
  const resources = [
    ...window.CALOS_DATA.resources,
    ...tools,
    ...(window.CALOS_DIRECTORY || []),
  ];
  const byId = new Map(resources.map((item) => [item.id, item]));
  const sections = {
    anime: {
      title: "动漫收藏",
      en: "ANIME",
      description: "好故事，陪你度过每一个平凡日常",
    },
    movies: {
      title: "电影放映室",
      en: "CINEMA",
      description: "打开一部电影，走进另一个世界",
    },
    mugen: {
      title: "MUGEN 工坊",
      en: "MUGEN",
      description: "人物、工具与教程，都收在这里",
    },
    software: {
      title: "软件与工具",
      en: "TOOLS",
      description: "日常好工具，按用途慢慢挑选",
    },
    design: {
      title: "设计灵感",
      en: "DESIGN",
      description: "图库、壁纸、模板与创意工具，给灵感一个入口",
    },
  };
  /* 三个收藏分区的壁纸保持用户指定 URL；仅在进入该分区时加载。 */
  const wallpapers = {
    anime: "https://pic1.imgdb.cn/i/034ZqilTgZSkaU7ettIqE2.jpg",
    movies:
      "https://image.tmdb.org/t/p/original/5jhG1lTgV0MS6tDkBMQSSitttTT.jpg",
    mugen: "https://pic1.imgdb.cn/i/034ZrgfvYwnC3oYXAkffGp.png",
  };
  const state = {
    section: "anime",
    query: "",
    category: "all",
    page: 1,
    scope: "current",
    sort: "relevance",
  };
  const PAGE_SIZE = 12;
  let matches = [];
  let searchTimer;
  let isComposing = false;
  let verified = false;
  $("#total-count").textContent = String(resources.length);
  $$(".side-nav button[data-section]").forEach((button) => {
    const count = resources.filter(
      (r) => r.section === button.dataset.section,
    ).length;
    let badge = button.querySelector("span");
    if (!badge) {
      badge = document.createElement("span");
      button.append(badge);
    }
    badge.textContent = String(count);
  });

  /* ==================== 本地全文搜索：MiniSearch 7.2.0 + 中文分词 ==================== */
  const normalize = (value) =>
    String(value).normalize("NFKC").toLocaleLowerCase("zh-CN");
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter("zh-CN", { granularity: "word" })
      : null;
  function tokenize(value) {
    const text = normalize(value);
    const tokens = new Set(text.match(/[a-z0-9]+/g) || []);
    // 中文单字与相邻二元词保证人名、作品名以及任意子串都可检索。
    for (const chunk of text.match(/[\p{Script=Han}]+/gu) || []) {
      const chars = [...chunk];
      chars.forEach((char, i) => {
        tokens.add(char);
        if (i + 1 < chars.length) tokens.add(char + chars[i + 1]);
      });
    }
    if (segmenter) {
      for (const item of segmenter.segment(text)) {
        if (
          item.isWordLike &&
          (/^[a-z0-9]+$/.test(item.segment) || [...item.segment].length <= 2)
        )
          tokens.add(item.segment);
      }
    }
    return [...tokens];
  }
  let searchIndex = null;
  if (typeof window.MiniSearch === "function") {
    searchIndex = new window.MiniSearch({
      fields: ["title", "category", "description"],
      storeFields: ["section", "category"],
      tokenize,
      processTerm: (term) => term,
      searchOptions: {
        boost: { title: 4 },
        combineWith: "AND",
        prefix: true,
        fuzzy: (term) => (/^[a-z]{4,}$/.test(term) ? 0.2 : false),
      },
    });
    searchIndex.addAll(resources);
  }
  function scopedResources() {
    return state.scope === "all"
      ? resources
      : resources.filter((r) => r.section === state.section);
  }
  function searchResources() {
    const allowed = new Set(
      scopedResources()
        .filter(
          (r) => state.category === "all" || r.category === state.category,
        )
        .map((r) => r.id),
    );
    const query = normalize(state.query.trim());
    let found;
    if (query && searchIndex) {
      const result = searchIndex.search(query, {
        filter: (r) => allowed.has(r.id),
      });
      found = result.map((r) => byId.get(r.id));
      // 精确作品名子串优先，同时保留前缀、容错与相关性检索结果。
      found.sort(
        (a, b) =>
          Number(normalize(b.title).includes(query)) -
          Number(normalize(a.title).includes(query)),
      );
    } else {
      const terms = tokenize(query);
      found = resources.filter(
        (r) =>
          allowed.has(r.id) &&
          terms.every((t) =>
            normalize(
              r.title + " " + r.category + " " + (r.description || ""),
            ).includes(t),
          ),
      );
    }
    if (state.sort === "name")
      found.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    if (state.sort === "year") found.sort((a, b) => getYear(b) - getYear(a));
    return found;
  }
  function getYear(resource) {
    return Number(resource.title.match(/(?:19|20)\d{2}/)?.[0] || 0);
  }

  /* ==================== 安全生成卡片与命中高亮 ==================== */
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.setAttribute("aria-hidden", "true");
    svg.append(use);
    return svg;
  }
  function highlightedTitle(title) {
    const heading = node("h3");
    const words = state.query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!words.length) {
      heading.textContent = title;
      return heading;
    }
    const escaped = words.map((word) =>
      word.replace(/[.*+?^$()|[\]\\]/g, "\\$&"),
    );
    const regex = new RegExp("(" + escaped.join("|") + ")", "giu");
    let last = 0;
    for (const match of title.matchAll(regex)) {
      heading.append(
        document.createTextNode(title.slice(last, match.index)),
        node("mark", "", match[0]),
      );
      last = match.index + match[0].length;
    }
    heading.append(document.createTextNode(title.slice(last)));
    return heading;
  }
  function makeCard(resource, index) {
    const card = node("article", "resource-card");
    const head = node("div", "card-head");
    head.append(
      node("span", "category-badge", resource.category),
      node("span", "card-index", String(index + 1).padStart(3, "0")),
    );
    const bottom = node("div", "card-bottom");
    const quality = resource.title.match(
      /(?:4K|2160p|1080p|720p|蓝光|高清)/i,
    )?.[0];
    const meta = [
      getYear(resource) || "",
      quality || (resource.public ? "精选站点" : "资源分享"),
    ]
      .filter(Boolean)
      .join(" · ");
    bottom.append(node("span", "resource-meta", meta));
    if (resource.url) {
      const link = node(
        "a",
        "resource-link",
        resource.public ? "前往看看" : "获取资源",
      );
      link.href = resource.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.dataset.resource = resource.id;
      link.append(icon("arrow"));
      bottom.append(link);
    } else {
      bottom.append(node("span", "unavailable", "链接待补充"));
    }
    card.append(head);
    if (resource.icon) {
      // 本地图标懒加载，固定尺寸避免跳动；异常时使用本地后备 SVG。
      const identity = node("div", "resource-identity");
      const image = node("img", "resource-icon");
      image.src = resource.icon;
      image.alt = "";
      image.title = resource.iconFallback
        ? "首字标识（原站图标暂不可用）"
        : resource.title + "站点图标";
      image.width = 40;
      image.height = 40;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener(
        "error",
        () => {
          image.src = "assets/icons/fallback.svg";
        },
        { once: true },
      );
      const details = node("div", "resource-identity-text");
      details.append(highlightedTitle(resource.title));
      try {
        details.append(
          node("span", "resource-domain", new URL(resource.url).hostname),
        );
      } catch {
        /* 外链格式问题不阻断其他资源的展示。 */
      }
      identity.append(image, details);
      card.append(identity);
      if (resource.description)
        card.append(node("p", "resource-description", resource.description));
      if (resource.section === "software") {
        const source = node("a", "resource-source", "原站详情与下载选项 ↗");
        source.href = resource.source;
        source.target = "_blank";
        source.rel = "noopener noreferrer";
        card.append(source);
      }
    } else {
      card.append(highlightedTitle(resource.title));
    }
    card.append(bottom);
    return card;
  }

  /* ==================== 分区、分类与分页渲染 ==================== */
  function renderCategories() {
    const list = scopedResources();
    const counts = new Map();
    list.forEach((r) =>
      counts.set(r.category, (counts.get(r.category) || 0) + 1),
    );
    const all = [["all", list.length], ...counts.entries()];
    const fragment = document.createDocumentFragment();
    all.forEach(([category, count]) => {
      const button = node(
        "button",
        category === state.category ? "active" : "",
        category === "all" ? "全部收藏" : category,
      );
      button.type = "button";
      button.dataset.category = category;
      button.setAttribute("aria-pressed", String(category === state.category));
      button.append(node("small", "", String(count)));
      fragment.append(button);
    });
    $("#category-filters").replaceChildren(fragment);
  }
  function renderPagination(totalPages) {
    const nav = $("#pagination");
    nav.hidden = totalPages <= 1;
    const fragment = document.createDocumentFragment();
    function pageButton(label, page, disabled = false, className = "") {
      const b = node("button", className, label);
      b.type = "button";
      b.dataset.page = page;
      b.disabled = disabled;
      if (page === state.page && /^\d+$/.test(label))
        b.setAttribute("aria-current", "page");
      fragment.append(b);
    }
    pageButton("← 上一页", state.page - 1, state.page === 1, "page-arrow");
    const numbers = new Set(
      [1, totalPages, state.page - 1, state.page, state.page + 1].filter(
        (n) => n > 0 && n <= totalPages,
      ),
    );
    let previous = 0;
    [...numbers]
      .sort((a, b) => a - b)
      .forEach((page) => {
        if (previous && page - previous > 1)
          fragment.append(node("span", "", "…"));
        pageButton(
          String(page),
          page,
          false,
          page === state.page ? "active" : "",
        );
        previous = page;
      });
    pageButton(
      "下一页 →",
      state.page + 1,
      state.page === totalPages,
      "page-arrow",
    );
    nav.replaceChildren(fragment);
  }
  function render() {
    const started = performance.now();
    matches = searchResources();
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    state.page = Math.min(pageCount, Math.max(1, state.page));
    const offset = (state.page - 1) * PAGE_SIZE;
    const fragment = document.createDocumentFragment();
    matches
      .slice(offset, offset + PAGE_SIZE)
      .forEach((r, index) => fragment.append(makeCard(r, offset + index)));
    $("#resource-grid").replaceChildren(fragment);
    $("#empty-state").hidden = matches.length > 0;
    const pending = !scopedResources().length;
    $("#empty-title").textContent = pending
      ? "好东西，正在路上。"
      : "还没有找到这份收藏";
    $("#empty-description").textContent = pending
      ? "这个分区还在整理中。先去动漫或电影分区，发现一份喜欢的收藏吧。"
      : "换个关键词，或者选择「全部收藏」搜索其他分区。";
    $("#reset-filters").hidden = pending;
    const range = matches.length
      ? " · 正在展示 " +
        (offset + 1) +
        "–" +
        Math.min(offset + PAGE_SIZE, matches.length)
      : "";
    $("#result-summary").textContent =
      (state.query ? "「" + state.query + "」找到 " : "共 ") +
      matches.length +
      " 份收藏" +
      range;
    $("#clear-search").hidden = !state.query;
    renderPagination(pageCount);
    window.CALOS_SEARCH_METRICS = {
      durationMs: performance.now() - started,
      count: matches.length,
    };
  }
  /* ==================== 胶囊导航：选中层 + 鼠标／键盘追踪层 ==================== */
  const headerNav = $(".header-nav");
  const headerButtons = $$(".header-nav button[data-section]");
  let hoveredNavButton = null;
  let navFrame = 0;
  function updateNavSliders() {
    const selected = headerButtons.find((button) =>
      button.classList.contains("active"),
    );
    if (!selected) return;
    const focused = headerNav.contains(document.activeElement)
      ? document.activeElement.closest("button[data-section]")
      : null;
    const preview = hoveredNavButton || focused || selected;
    const bounds = headerNav.getBoundingClientRect();
    function measure(button, prefix) {
      const rect = button.getBoundingClientRect();
      headerNav.style.setProperty(
        `--nav-${prefix}-x`,
        `${rect.left - bounds.left - headerNav.clientLeft}px`,
      );
      headerNav.style.setProperty(`--nav-${prefix}-width`, `${rect.width}px`);
      headerNav.style.setProperty("--nav-slider-height", `${rect.height}px`);
    }
    measure(selected, "current");
    measure(preview, "preview");
    headerNav.classList.toggle("has-preview", preview !== selected);
    headerButtons.forEach((button) =>
      button.classList.toggle(
        "is-preview",
        button === preview && preview !== selected,
      ),
    );
    headerNav.classList.add("is-ready");
  }
  function scheduleNavSliders() {
    if (navFrame) return;
    navFrame = requestAnimationFrame(() => {
      navFrame = 0;
      updateNavSliders();
    });
  }
  headerButtons.forEach((button) => {
    button.addEventListener("pointerenter", (event) => {
      // 触摸操作只更新选中项，不产生鼠标悬停残留。
      if (event.pointerType === "touch") return;
      hoveredNavButton = button;
      updateNavSliders();
    });
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch") hoveredNavButton = null;
    });
  });
  headerNav.addEventListener("pointerleave", () => {
    hoveredNavButton = null;
    updateNavSliders();
  });
  headerNav.addEventListener("focusin", () => {
    hoveredNavButton = null;
    updateNavSliders();
  });
  headerNav.addEventListener("focusout", () =>
    queueMicrotask(updateNavSliders),
  );
  headerNav.addEventListener("keydown", (event) => {
    const index = headerButtons.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % headerButtons.length;
    else if (event.key === "ArrowLeft")
      next = (index + headerButtons.length - 1) % headerButtons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = headerButtons.length - 1;
    else return;
    event.preventDefault();
    headerButtons[next].focus();
  });
  if (typeof ResizeObserver === "function") {
    const navObserver = new ResizeObserver(scheduleNavSliders);
    navObserver.observe(headerNav);
    headerButtons.forEach((button) => navObserver.observe(button));
  }
  window.addEventListener("resize", scheduleNavSliders, { passive: true });

  function switchSection(section) {
    if (!sections[section]) return;
    state.section = section;
    const wallpaper = wallpapers[section];
    const image = $("#anime-banner img");
    $("#anime-banner").hidden = !wallpaper;
    $("#collection-intro").hidden = !!wallpaper;
    if (wallpaper) {
      $("#anime-banner-title").textContent =
        sections[section].title + " · 收藏热爱，分享美好";
      image.alt = sections[section].title + "主题图";
      if (image.getAttribute("src") !== wallpaper) {
        $("#anime-banner-status").hidden = true;
        image.src = wallpaper;
      }
    }
    const sourceNote = $("#catalog-source");
    sourceNote.hidden = !["software", "design"].includes(section);
    if (!sourceNote.hidden) {
      const software = section === "software";
      const sourceLink = node(
        "a",
        "",
        software ? "纯净派" : "龙轩导航 · 设计模板",
      );
      sourceLink.href = software
        ? "https://chunjing.app/"
        : "http://ilxdh.com/cat/174";
      sourceLink.target = "_blank";
      sourceLink.rel = "noopener noreferrer";
      sourceNote.replaceChildren(
        document.createTextNode("整理自 "),
        sourceLink,
        document.createTextNode(
          software
            ? " · 2026-10-04 核对。前往官网获取版本与许可信息；这里只整理入口，不提供安装包。"
            : " · 2026-10-04 核对。按原站 8 类保留 158 个分类条目；素材使用与商用授权请以目标网站说明为准。",
        ),
      );
    }
    const suggestions = {
      anime: ["犬夜叉", "1080p", "经典"],
      movies: ["电影", "1080p", "2000"],
      mugen: ["人物", "工具", "教学"],
      software: ["7-Zip", "截图", "文件"],
      design: ["PPT", "字体", "图标"],
    };
    $$(".quick-search [data-query]").forEach((button, i) => {
      button.dataset.query = suggestions[section][i];
      button.textContent = suggestions[section][i];
    });
    state.category = "all";
    state.page = 1;
    const config = sections[section];
    const title = $("#collection-title");
    title.replaceChildren(
      document.createTextNode(config.title),
      node("span", "", config.en),
    );
    const count = resources.filter((r) => r.section === section).length;
    $("#section-total").textContent = count + " 份收藏 · " + config.description;
    $$("[data-section]").forEach((button) => {
      const active = button.dataset.section === section;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    updateNavSliders();
    renderCategories();
    render();
  }
  $$("[data-section]").forEach((button) =>
    button.addEventListener("click", () =>
      switchSection(button.dataset.section),
    ),
  );
  $("#explore").addEventListener("click", () =>
    $("#collection").scrollIntoView({
      behavior: motionReduced.matches ? "instant" : "smooth",
    }),
  );
  $("#category-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    state.page = 1;
    renderCategories();
    render();
  });
  $("#pagination").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page);
    render();
    $("#collection").scrollIntoView({
      behavior: motionReduced.matches ? "instant" : "smooth",
    });
  });
  function updateSearch() {
    clearTimeout(searchTimer);
    state.query = $("#search-input").value;
    state.page = 1;
    render();
  }
  $("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    updateSearch();
  });
  $("#search-input").addEventListener("compositionstart", () => {
    isComposing = true;
  });
  $("#search-input").addEventListener("compositionend", () => {
    isComposing = false;
    updateSearch();
  });
  $("#search-input").addEventListener("input", () => {
    if (!isComposing) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(updateSearch, 100);
    }
  });
  $("#clear-search").addEventListener("click", () => {
    $("#search-input").value = "";
    updateSearch();
    $("#search-input").focus();
  });
  $$("[data-query]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#search-input").value = b.dataset.query;
      updateSearch();
    }),
  );
  $("#search-scope").addEventListener("change", (event) => {
    state.scope = event.target.value;
    state.category = "all";
    state.page = 1;
    renderCategories();
    render();
  });
  $("#sort-select").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.page = 1;
    render();
  });
  $("#reset-filters").addEventListener("click", () => {
    $("#search-input").value = "";
    state.category = "all";
    renderCategories();
    updateSearch();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
    ) {
      event.preventDefault();
      $("#search-input").focus();
      $("#collection").scrollIntoView();
    }
    if (event.key === "Escape") {
      setSidebar(false);
      $(".wechat-tool").classList.remove("is-open");
      $("#wechat-toggle").setAttribute("aria-expanded", "false");
    }
  });

  /* ==================== 左侧边缘感应、折叠与固定展开 ==================== */
  const sidebar = $("#sidebar");
  let pinned = store.get("calos-sidebar-pinned", "false") === "true";
  let closeTimer;
  function cancelSidebarClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  function setSidebar(open, force = false) {
    if (!open && pinned && !force) return;
    const next = Boolean(open || pinned);
    sidebar.classList.toggle("is-open", next);
    sidebar.inert = !next;
    $("#sidebar-edge").setAttribute("aria-expanded", String(next));
  }
  function updatePin() {
    document.body.classList.toggle("sidebar-pinned", pinned);
    $("#pin-sidebar").setAttribute("aria-pressed", String(pinned));
    $("#pin-sidebar span").textContent = pinned ? "取消固定" : "固定侧栏";
    store.set("calos-sidebar-pinned", String(pinned));
  }
  $("#sidebar-edge").addEventListener("pointerenter", () => {
    cancelSidebarClose();
    setSidebar(true);
  });
  $("#sidebar-edge").addEventListener("click", () => {
    cancelSidebarClose();
    setSidebar(true);
  });
  sidebar.addEventListener("pointerenter", cancelSidebarClose);
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse" || pinned) return;
      if (event.clientX <= 14) {
        cancelSidebarClose();
        setSidebar(true);
      } else if (event.clientX <= 330) cancelSidebarClose();
      else if (sidebar.classList.contains("is-open") && !closeTimer) {
        closeTimer = setTimeout(() => {
          closeTimer = null;
          setSidebar(false);
        }, 450);
      }
    },
    { passive: true },
  );
  $("#pin-sidebar").addEventListener("click", () => {
    pinned = !pinned;
    clearTimeout(closeTimer);
    closeTimer = null;
    updatePin();
    setSidebar(true);
  });
  $("#sidebar-close").addEventListener("click", () => {
    pinned = false;
    updatePin();
    clearTimeout(closeTimer);
    closeTimer = null;
    $("#sidebar-close").blur();
    setSidebar(false);
  });
  sidebar.addEventListener("focusout", () => {
    if (!pinned) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (
          !sidebar.contains(document.activeElement) &&
          !sidebar.matches(":hover")
        )
          setSidebar(false);
      }, 450);
    }
  });
  updatePin();
  setSidebar(pinned);

  /* ==================== 主题偏好与快捷操作 ==================== */
  const motionReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let theme = store.get("calos-theme", "light");
  function updateTheme() {
    document.documentElement.dataset.theme = theme;
    $("#theme-toggle").replaceChildren(icon(theme === "dark" ? "sun" : "moon"));
    $("#theme-toggle").setAttribute(
      "aria-label",
      theme === "dark" ? "切换为浅色主题" : "切换为深色主题",
    );
    $('meta[name="theme-color"]').content =
      theme === "dark" ? "#241321" : "#fff1f6";
    document.dispatchEvent(new CustomEvent("calos:themechange"));
  }
  $("#theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    store.set("calos-theme", theme);
    updateTheme();
  });
  $("#back-top").addEventListener("click", () =>
    window.scrollTo({
      top: 0,
      behavior: motionReduced.matches ? "instant" : "smooth",
    }),
  );
  $("#wechat-toggle").addEventListener("click", () => {
    const open = $(".wechat-tool").classList.toggle("is-open");
    $("#wechat-toggle").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".wechat-tool")) {
      $(".wechat-tool").classList.remove("is-open");
      $("#wechat-toggle").setAttribute("aria-expanded", "false");
    }
  });
  updateTheme();
  /* 共用壁纸按加载结果恢复实际比例，远端连接失败不影响本地资源列表。 */
  const bannerImage = $("#anime-banner img");
  bannerImage.addEventListener("error", () => {
    $("#anime-banner-status").hidden = false;
  });
  bannerImage.addEventListener("load", () => {
    $("#anime-banner-status").hidden = true;
    bannerImage.width = bannerImage.naturalWidth;
    bannerImage.height = bannerImage.naturalHeight;
    bannerImage.style.aspectRatio = `${bannerImage.naturalWidth} / ${bannerImage.naturalHeight}`;
  });
  if (bannerImage.complete && !bannerImage.naturalWidth)
    $("#anime-banner-status").hidden = false;

  /* ==================== 原有暗号验证：不缓存解锁状态、不变更资源 URL ==================== */
  const dialog = $("#verification-dialog");
  function notify(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => {
      toast.hidden = true;
    }, 3500);
  }
  $("#resource-grid").addEventListener("click", (event) => {
    const link = event.target.closest("[data-resource]");
    if (!link) return;
    const resource = byId.get(link.dataset.resource);
    if (!verified && !resource.public) {
      event.preventDefault();
      $("#verification-error").hidden = true;
      $("#code-input").value = "";
      dialog.showModal();
    }
  });
  $("#verification-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
  $("#verification-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("#code-input").value.trim() === "12345") {
      verified = true;
      dialog.close();
      notify("收藏已解锁，再次点击资源即可访问。");
    } else {
      $("#verification-error").hidden = false;
      $("#code-input").select();
    }
  });

  /* ==================== 作者打赏弹窗：原图只用于本页 300×300 放大，不跳转 ==================== */
  const paymentDialog = $("#payment-dialog");
  let paymentOpener;
  $(".support-cards").addEventListener("click", (event) => {
    const button = event.target.closest(".support-zoom");
    if (!button || paymentDialog.open) return;
    const image = button.querySelector("img");
    paymentOpener = button;
    $("#payment-title").textContent = button.dataset.payment;
    $("#payment-image").src = image.currentSrc || image.src;
    $("#payment-image").alt = image.alt;
    paymentDialog.showModal();
    document.documentElement.classList.add("payment-modal-open");
  });
  $("#payment-close").addEventListener("click", () => paymentDialog.close());
  // 弹窗只有一个可操作控件，Tab／Shift+Tab 循环停留在关闭按钮。
  paymentDialog.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      $("#payment-close").focus();
    }
  });
  paymentDialog.addEventListener("click", (event) => {
    if (event.target !== paymentDialog) return;
    const rect = paymentDialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      paymentDialog.close();
  });
  // Esc 沿用原生关闭行为；所有关闭路径均恢复页面滚动及触发按钮焦点。
  paymentDialog.addEventListener("close", () => {
    document.documentElement.classList.remove("payment-modal-open");
    paymentOpener?.focus({ preventScroll: true });
  });

  /* ==================== 原版云朵式语录：从底部中央上漂、轻摇、淡出 ==================== */
  let quoteEnabled = store.get("calos-quotes", "true") !== "false";
  let quoteIndex = Math.floor(Math.random() * window.CALOS_DATA.quotes.length);
  let quoteTimer;
  let quoteHideTimer;
  function pauseQuotes() {
    clearTimeout(quoteTimer);
    clearTimeout(quoteHideTimer);
    $("#quote-toast").classList.remove("visible");
  }
  function showQuote() {
    pauseQuotes();
    if (!quoteEnabled || document.hidden || motionReduced.matches) return;
    const quote = window.CALOS_DATA.quotes[
      quoteIndex++ % window.CALOS_DATA.quotes.length
    ].replace(/❤/g, "");
    $("#quote-text").textContent = quote;
    $("#quote-toast").classList.add("visible");
    quoteHideTimer = setTimeout(
      () => $("#quote-toast").classList.remove("visible"),
      20000,
    );
    quoteTimer = setTimeout(showQuote, 24000);
  }
  function updateQuotePreference() {
    $("#quote-toggle").textContent = quoteEnabled
      ? "关闭底部语录"
      : "开启底部语录";
    $("#quote-toggle").setAttribute("aria-pressed", String(quoteEnabled));
    pauseQuotes();
    if (quoteEnabled && !document.hidden && !motionReduced.matches)
      quoteTimer = setTimeout(showQuote, 5000);
  }
  $("#quote-toggle").addEventListener("click", () => {
    quoteEnabled = !quoteEnabled;
    store.set("calos-quotes", String(quoteEnabled));
    updateQuotePreference();
  });
  motionReduced.addEventListener("change", updateQuotePreference);
  updateQuotePreference();

  /* ==================== 页脚时钟：30 秒更新一次，无秒针与声音开销 ==================== */
  let clockTimer;
  function updateClock() {
    const now = new Date();
    $("#clock-time").textContent = now.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    $("#clock-date").textContent = now.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    $("#hour-hand").style.transform =
      "rotate(" + ((now.getHours() % 12) * 30 + now.getMinutes() / 2) + "deg)";
    $("#minute-hand").style.transform =
      "rotate(" + now.getMinutes() * 6 + "deg)";
    $("#copyright-year").textContent = now.getFullYear();
    // 用本地年月日计算序号，UTC 日期差规避夏令时，闰年按 366 天计算。
    const year = now.getFullYear();
    const start = Date.UTC(year, 0, 1);
    const totalDays = (Date.UTC(year + 1, 0, 1) - start) / 86400000;
    const passedDays =
      Math.floor(
        (Date.UTC(year, now.getMonth(), now.getDate()) - start) / 86400000,
      ) + 1;
    const percent = ((passedDays / totalDays) * 100).toFixed(1);
    $("#year-progress-text").textContent =
      `${year}年已过 ${passedDays} / ${totalDays} 天，占全年 ${percent}%`;
    $("#year-progress-bar").value = Number(percent);
    $("#year-progress-bar").textContent = percent + "%";
  }
  /* 原版站内运行时间统计：沿用 2023 年 4 月 7 日起点，精确到秒。 */
  let runtimeTimer;
  function showRuntime() {
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - new Date(2023, 3, 7).getTime()) / 1000),
    );
    const days = Math.floor(elapsed / 86400);
    const hours = Math.floor(elapsed / 3600) % 24;
    const minutes = Math.floor(elapsed / 60) % 60;
    const seconds = elapsed % 60;
    $("#runtime_span").textContent =
      `🕑本站已快乐运行: ${days}天${hours}小时${minutes}分${seconds}秒`;
  }
  function resumeRuntime() {
    clearInterval(runtimeTimer);
    showRuntime();
    runtimeTimer = setInterval(showRuntime, 1000);
  }
  function resumeClock() {
    clearInterval(clockTimer);
    updateClock();
    clockTimer = setInterval(updateClock, 30000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseQuotes();
      clearInterval(clockTimer);
      clearInterval(runtimeTimer);
    } else {
      resumeClock();
      resumeRuntime();
      updateQuotePreference();
    }
  });
  resumeClock();
  resumeRuntime();

  /* ==================== 原版音乐与评论服务：自动初始化，异常不影响本地功能 ==================== */
  const pendingScripts = new Map();
  function loadScript(src) {
    if (pendingScripts.has(src)) return pendingScripts.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error("连接超时"));
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("连接失败"));
      };
      document.head.append(script);
    }).catch((error) => {
      pendingScripts.delete(src);
      throw error;
    });
    pendingScripts.set(src, promise);
    return promise;
  }
  const musicPanel = $("#music-panel");
  // 播放器样式以非阻塞方式下载，加载后应用，核心搜索不等待远端 CSS。
  const musicStylesheet = $("#aplayer-style");
  musicStylesheet.addEventListener("load", () => {
    musicStylesheet.media = "all";
  });
  if (musicStylesheet.sheet) musicStylesheet.media = "all";
  const musicStatus = $("#music-status");
  const player = musicPanel.querySelector("meting-js");
  let musicTimeout;
  const musicObserver = new MutationObserver(() => {
    if (player.querySelector(".aplayer")) {
      musicStatus.hidden = true;
      clearTimeout(musicTimeout);
      musicObserver.disconnect();
    }
  });
  musicObserver.observe(player, { childList: true, subtree: true });
  function reportMusic() {
    if (!window.APlayer || !window.customElements.get("meting-js")) return;
    musicStatus.textContent = "正在加载原网易云歌单…";
    if (player.querySelector(".aplayer")) {
      musicStatus.hidden = true;
      musicObserver.disconnect();
      return;
    }
    clearTimeout(musicTimeout);
    musicTimeout = setTimeout(() => {
      musicStatus.textContent = "歌单暂时未返回，请检查网络或稍后刷新。";
    }, 15000);
  }
  for (const id of ["#aplayer-service", "#meting-service"]) {
    $(id).addEventListener("load", reportMusic);
    $(id).addEventListener("error", () => {
      clearTimeout(musicTimeout);
      musicStatus.hidden = false;
      musicStatus.textContent =
        "音乐服务暂时无法连接；分区、搜索仍可正常使用。";
    });
  }
  reportMusic();
  $("#music-toggle").addEventListener("click", () => {
    musicPanel.hidden = !musicPanel.hidden;
    $("#music-toggle").setAttribute(
      "aria-expanded",
      String(!musicPanel.hidden),
    );
  });

  /* 原 CommentBox 服务及项目编号保持不变，默认显示在整个页面的底部。 */
  let commentsLoaded = false;
  let commentsLoading = false;
  let commentCleanup;
  function initializeComments() {
    if (commentsLoaded || typeof window.commentBox !== "function") return;
    try {
      commentCleanup = window.commentBox("5766227964198912-proj");
      commentsLoaded = true;
      $("#comments-status").hidden = true;
    } catch {
      $("#comments-status").hidden = false;
      $("#comments-status").textContent =
        "留言服务暂时无法初始化，点击「留下一句话」可重新尝试。";
    }
  }
  $("#commentbox-service").addEventListener("load", initializeComments);
  $("#commentbox-service").addEventListener("error", () => {
    $("#comments-status").textContent =
      "留言服务暂时无法连接，点击「留下一句话」可重新尝试。";
  });
  initializeComments();
  $("#comments-toggle").addEventListener("click", async () => {
    $("#comments-panel").scrollIntoView({
      behavior: motionReduced.matches ? "instant" : "smooth",
      block: "start",
    });
    if (commentsLoaded || commentsLoading) return;
    commentsLoading = true;
    $("#comments-status").hidden = false;
    $("#comments-status").textContent = "正在重连原有留言服务…";
    try {
      if (typeof window.commentBox !== "function")
        await loadScript(
          "https://unpkg.com/commentbox.io/dist/commentBox.min.js",
        );
      initializeComments();
    } catch {
      $("#comments-status").textContent = "留言服务暂时无法连接，请稍后再试。";
    } finally {
      commentsLoading = false;
    }
  });
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    musicObserver.disconnect();
    clearTimeout(musicTimeout);
    if (typeof commentCleanup === "function") commentCleanup();
  });
  switchSection("anime");
})();
